import { describe, expect, it } from "vitest";

import { PrismaApiKeyStorage } from "../../src/core/auth/api-keys/api-key-storage.prisma.js";
import type { ApiKeyRecord } from "../../src/core/auth/api-keys/api-key.service.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `PrismaApiKeyStorage` (CF.STORAGE.01 closure — iter-171).
 *
 * The `ApiKey` Prisma model exists at `prisma/schema.prisma:223`;
 * iter-171 introduces a Prisma-backed adapter that replaces the
 * `InMemoryApiKeyStorage` default in production. The story drives
 * the adapter against a fake `prisma.apiKey` delegate so the
 * mapping logic + error semantics are locked without spinning up
 * Postgres.
 */
describe("Story · PrismaApiKeyStorage delegates to prisma.apiKey (iter-171)", () => {
  function fakePrisma(): {
    prisma: PrismaService;
    captured: { create: unknown[]; delete: unknown[]; update: unknown[] };
  } {
    const captured = {
      create: [] as unknown[],
      delete: [] as unknown[],
      update: [] as unknown[],
    };
    const rows = new Map<string, Record<string, unknown>>();
    const fake = {
      apiKey: {
        async create(input: { data: Record<string, unknown> }) {
          captured.create.push(input.data);
          rows.set(String(input.data["id"]), input.data);
          return input.data;
        },
        async findUnique(input: { where: { id?: string; lookupId?: string } }) {
          if (input.where.id !== undefined) return rows.get(input.where.id) ?? null;
          if (input.where.lookupId !== undefined) {
            for (const r of rows.values()) {
              if (r["lookupId"] === input.where.lookupId) return r;
            }
            return null;
          }
          return null;
        },
        async findMany(input: { where: { userId: string } }) {
          return [...rows.values()].filter((r) => r["userId"] === input.where.userId);
        },
        async delete(input: { where: { id: string } }) {
          captured.delete.push(input.where);
          if (!rows.has(input.where.id)) {
            throw new Error("Record to delete does not exist.");
          }
          const existing = rows.get(input.where.id)!;
          rows.delete(input.where.id);
          return existing;
        },
        async update(input: { where: { id: string }; data: Record<string, unknown> }) {
          captured.update.push(input);
          if (!rows.has(input.where.id)) {
            throw new Error("Record to update not found.");
          }
          const existing = rows.get(input.where.id)!;
          const next = { ...existing, ...input.data };
          rows.set(input.where.id, next);
          return next;
        },
      },
    };
    return { prisma: fake as unknown as PrismaService, captured };
  }

  function sampleRecord(id: string, overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
    return {
      id,
      lookupId: `lk-${id}`,
      hash: `hash-${id}`,
      name: `key-${id}`,
      scopes: ["read"],
      userId: "u1",
      ...overrides,
    };
  }

  it("insert calls prisma.apiKey.create with row-shaped data", async () => {
    const { prisma, captured } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    const inserted = await storage.insert(sampleRecord("k1"));
    expect(captured.create).toHaveLength(1);
    const data = captured.create[0] as Record<string, unknown>;
    expect(data["id"]).toBe("k1");
    expect(data["lookupId"]).toBe("lk-k1");
    expect(data["lastNotifiedAt"]).toBeNull();
    expect(inserted.id).toBe("k1");
  });

  it("findById returns the mapped record", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    await storage.insert(sampleRecord("k1"));
    const found = (await storage.findById("k1"))!;
    expect(found.lookupId).toBe("lk-k1");
    expect(found.scopes).toEqual(["read"]);
  });

  it("findById returns null for a missing id", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    expect(await storage.findById("missing")).toBeNull();
  });

  it("findByLookupId resolves through the unique lookupId index", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    await storage.insert(sampleRecord("k1"));
    const found = (await storage.findByLookupId("lk-k1"))!;
    expect(found.id).toBe("k1");
  });

  it("findByLookupId returns null when no row matches", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    expect(await storage.findByLookupId("missing")).toBeNull();
  });

  it("listByUser filters by userId via prisma.apiKey.findMany", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    await storage.insert(sampleRecord("k1", { userId: "u1" }));
    await storage.insert(sampleRecord("k2", { userId: "u1" }));
    await storage.insert(sampleRecord("k3", { userId: "u2" }));
    const u1Keys = await storage.listByUser("u1");
    expect(u1Keys.map((k) => k.id).sort()).toEqual(["k1", "k2"]);
    const u2Keys = await storage.listByUser("u2");
    expect(u2Keys.map((k) => k.id)).toEqual(["k3"]);
  });

  it("delete returns true on success, false when prisma throws", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    await storage.insert(sampleRecord("k1"));
    expect(await storage.delete("k1")).toBe(true);
    expect(await storage.delete("k1")).toBe(false);
  });

  it("updateLastUsed best-effort writes the new timestamp", async () => {
    const { prisma, captured } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    await storage.insert(sampleRecord("k1"));
    const at = new Date("2026-05-05T12:00:00Z");
    await storage.updateLastUsed("k1", at);
    expect(captured.update).toHaveLength(1);
    const upd = captured.update[0] as { data: { lastUsedAt: Date } };
    expect(upd.data.lastUsedAt).toEqual(at);
  });

  it("updateLastUsed silently swallows the missing-row case (best-effort)", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    // No insert — update should not throw.
    await expect(storage.updateLastUsed("missing", new Date())).resolves.toBeUndefined();
  });

  it("rotate replaces lookupId + hash, returns updated record", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    await storage.insert(sampleRecord("k1"));
    const updated = (await storage.rotate("k1", "lk-new", "hash-new"))!;
    expect(updated.lookupId).toBe("lk-new");
    expect(updated.hash).toBe("hash-new");
    expect(updated.id).toBe("k1");
  });

  it("rotate returns null when the row is missing", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    expect(await storage.rotate("missing", "lk", "h")).toBeNull();
  });

  it("fromRow preserves expiresAt + lastUsedAt when set, omits when null", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    await storage.insert(
      sampleRecord("k1", {
        expiresAt: new Date("2026-12-31T23:59:59Z"),
        lastUsedAt: new Date("2026-05-01T10:00:00Z"),
      }),
    );
    const found = (await storage.findById("k1"))!;
    expect(found.expiresAt).toBeInstanceOf(Date);
    expect(found.lastUsedAt).toBeInstanceOf(Date);

    await storage.insert(sampleRecord("k2"));
    const k2 = (await storage.findById("k2"))!;
    expect(k2.expiresAt).toBeUndefined();
    expect(k2.lastUsedAt).toBeUndefined();
  });

  it("scopes array is defensively copied (mutating the result does not corrupt the row)", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaApiKeyStorage(prisma);
    await storage.insert(sampleRecord("k1", { scopes: ["read", "write"] }));
    const first = (await storage.findById("k1"))!;
    first.scopes.push("admin");
    const second = (await storage.findById("k1"))!;
    expect(second.scopes).toEqual(["read", "write"]);
  });
});
