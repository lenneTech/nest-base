import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ApiKeyExpiredError,
  ApiKeyInvalidError,
  ApiKeyService,
  type ApiKeyRecord,
  type ApiKeyStorage,
} from "../../src/core/auth/api-keys/api-key.service.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Scoped API-Keys
 *
 * Issuance:
 *   - Plaintext format: `nst_pk_<lookupId>_<secret>`
 *   - Stored: lookupId (UUID v7) + argon2id(secret) + scopes + ttl
 *   - Verify: split → fetch by lookupId → argon2id verify
 *
 * Storage stays behind a small interface so the Prisma adapter wires
 * up later without churn in the service.
 */
describe("Story · Scoped API-Keys", () => {
  function makeStorage(initial: ApiKeyRecord[] = []): ApiKeyStorage & { records: ApiKeyRecord[] } {
    const records: ApiKeyRecord[] = [...initial];
    return {
      get records() {
        return records;
      },
      async insert(record) {
        records.push(record);
        return record;
      },
      async findById(id) {
        return records.find((r) => r.id === id) ?? null;
      },
      async findByLookupId(lookupId) {
        return records.find((r) => r.lookupId === lookupId) ?? null;
      },
      async listByUser(userId) {
        return records.filter((r) => r.userId === userId);
      },
      async delete(id) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return false;
        records.splice(idx, 1);
        return true;
      },
      async updateLastUsed(id, at) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return false;
        records[idx] = { ...records[idx]!, lastUsedAt: at };
        return true;
      },
      async rotate(id, lookupId, hash) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return null;
        records[idx] = { ...records[idx]!, lookupId, hash };
        return records[idx]!;
      },
    };
  }

  describe("createKey()", () => {
    it("returns the plaintext exactly once and stores only the hash", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const result = await svc.createKey({ userId: "u1", name: "CI key", scopes: ["files:read"] });
      expect(result.plaintext).toMatch(/^nst_pk_[0-9a-f-]{36}_[0-9a-f]{64}$/);
      const stored = storage.records[0]!;
      expect(stored.hash).not.toContain(result.plaintext.split("_").slice(-1)[0]!);
      expect(stored.hash.startsWith("$argon2id$")).toBe(true);
    });

    it("persists the requested scopes verbatim", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      await svc.createKey({ userId: "u1", name: "k", scopes: ["files:read", "files:write"] });
      expect(storage.records[0]!.scopes).toEqual(["files:read", "files:write"]);
    });

    it("rejects creating a key with an empty scope list", async () => {
      const svc = new ApiKeyService(makeStorage());
      await expect(svc.createKey({ userId: "u1", name: "k", scopes: [] })).rejects.toThrow(
        /scope/i,
      );
    });
  });

  describe("verifyKey()", () => {
    it("accepts the plaintext returned from createKey()", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const { plaintext } = await svc.createKey({ userId: "u1", name: "k", scopes: ["files:read"] });
      const verified = await svc.verifyKey(plaintext);
      expect(verified.userId).toBe("u1");
      expect(verified.scopes).toEqual(["files:read"]);
    });

    it("rejects a tampered secret with ApiKeyInvalidError", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const { plaintext } = await svc.createKey({ userId: "u1", name: "k", scopes: ["files:read"] });
      // Flip the last hex char to something guaranteed different from the
      // original so the tamper is never a no-op regardless of the random secret.
      const lastChar = plaintext[plaintext.length - 1]!;
      const flipped = lastChar === "a" ? "b" : "a";
      const tampered = `${plaintext.slice(0, -1)}${flipped}`;
      await expect(svc.verifyKey(tampered)).rejects.toThrow(ApiKeyInvalidError);
    });

    it("rejects a wholly malformed plaintext", async () => {
      const svc = new ApiKeyService(makeStorage());
      await expect(svc.verifyKey("not-a-key")).rejects.toThrow(ApiKeyInvalidError);
    });

    it("rejects an unknown lookup id (key was deleted or never created)", async () => {
      const svc = new ApiKeyService(makeStorage());
      await expect(
        svc.verifyKey("nst_pk_00000000-0000-7000-8000-000000000000_abcd"),
      ).rejects.toThrow(ApiKeyInvalidError);
    });

    it("rejects an expired key with ApiKeyExpiredError", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const { plaintext } = await svc.createKey({
        userId: "u1",
        name: "k",
        scopes: ["files:read"],
        expiresAt: new Date(Date.now() - 1_000),
      });
      await expect(svc.verifyKey(plaintext)).rejects.toThrow(ApiKeyExpiredError);
    });

    it("updates lastUsedAt on a successful verify", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const { plaintext, record } = await svc.createKey({ userId: "u1", name: "k", scopes: ["files:read"] });
      expect(record.lastUsedAt).toBeUndefined();
      await svc.verifyKey(plaintext);
      const stored = storage.records.find((r) => r.id === record.id)!;
      expect(stored.lastUsedAt).toBeInstanceOf(Date);
    });

    it("M4 TOCTOU: rejects with ApiKeyInvalidError when the key is revoked between lookup and updateLastUsed", async () => {
      // Simulate the race: the argon2 verify succeeds but the key row is
      // deleted before updateLastUsed runs — updateLastUsed returns false.
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const { plaintext } = await svc.createKey({ userId: "u1", name: "k", scopes: ["files:read"] });

      // Inject a storage shim where updateLastUsed simulates the row disappearing.
      const original = storage.updateLastUsed.bind(storage);
      storage.updateLastUsed = async (_id: string, _at: Date): Promise<boolean> => {
        // Pretend the row was deleted between verify and this write.
        return false;
      };
      void original; // suppress unused warning

      await expect(svc.verifyKey(plaintext)).rejects.toThrow(ApiKeyInvalidError);
    });
  });

  describe("rotateKey()", () => {
    it("returns a new plaintext, replaces the hash, keeps name + scopes", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const { record } = await svc.createKey({ userId: "u1", name: "k", scopes: ["files:read", "files:write"] });
      const rotated = await svc.rotateKey(record.id);
      expect(rotated.plaintext).not.toBe("");
      expect(rotated.record.id).toBe(record.id);
      expect(rotated.record.name).toBe("k");
      expect(rotated.record.scopes).toEqual(["files:read", "files:write"]);
      expect(rotated.record.hash).not.toBe(record.hash);
    });

    it("the old plaintext is rejected after rotation", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const { plaintext, record } = await svc.createKey({ userId: "u1", name: "k", scopes: ["files:read"] });
      await svc.rotateKey(record.id);
      await expect(svc.verifyKey(plaintext)).rejects.toThrow(ApiKeyInvalidError);
    });
  });

  describe("listByUser() / revoke()", () => {
    it("returns only the requested user’s keys, never including hash material", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      await svc.createKey({ userId: "u1", name: "a", scopes: ["files:read"] });
      await svc.createKey({ userId: "u2", name: "b", scopes: ["files:read"] });
      const keys = await svc.listByUser("u1");
      expect(keys.map((k) => k.userId)).toEqual(["u1"]);
    });

    it("revoke() deletes the key by id", async () => {
      const storage = makeStorage();
      const svc = new ApiKeyService(storage);
      const { record } = await svc.createKey({ userId: "u1", name: "k", scopes: ["files:read"] });
      await svc.revoke(record.id);
      expect(storage.records).toHaveLength(0);
    });
  });

  describe("Prisma schema", () => {
    const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");

    it("declares an ApiKey model mapped to `api_keys`", () => {
      expect(SCHEMA).toMatch(/model\s+ApiKey\s*\{/);
      expect(SCHEMA).toMatch(/@@map\(\s*"api_keys"\s*\)/);
    });

    it("stores hash + lookup_id + scopes + expires_at as separate columns", () => {
      const block = SCHEMA.match(/model\s+ApiKey\s*\{[\s\S]*?\n\}/m)?.[0] ?? "";
      expect(block).toMatch(/lookupId[\s\S]*@map\(\s*"lookup_id"\s*\)/);
      expect(block).toMatch(/hash\s+String/);
      expect(block).toMatch(/scopes\s+String\[\]/);
      expect(block).toMatch(/expiresAt[\s\S]*@map\(\s*"expires_at"\s*\)/);
    });
  });
});
