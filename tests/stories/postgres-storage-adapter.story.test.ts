import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PostgresStorageAdapter,
  type FileBlobOperations,
} from "../../src/core/files/postgres-storage-adapter.js";
import { StorageObjectNotFoundError } from "../../src/core/files/storage-adapter.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Postgres Storage Adapter.
 *
 * Stores blobs in Postgres via Prisma. The injectable
 * `FileBlobOperations` interface lets unit tests run without a DB;
 * the production binding wraps `prisma.fileBlob.*` calls.
 *
 * Schema: `FileBlob` model maps to `file_blobs` with snake_case
 * columns, has tenant_id (FK + RLS-scoped via the tenant policy
 * defined in iteration 23), unique key per row, mimeType, sizeBytes,
 * body (Bytes).
 */
describe("Story · Postgres Storage Adapter", () => {
  function makeOps(): FileBlobOperations & {
    rows: Map<string, { mimeType: string; body: Uint8Array }>;
  } {
    const rows = new Map<string, { mimeType: string; body: Uint8Array }>();
    return {
      get rows() {
        return rows;
      },
      async upsert(key, body, mimeType) {
        rows.set(key, { mimeType, body });
      },
      async findByKey(key) {
        return rows.get(key) ?? null;
      },
      async deleteByKey(key) {
        return rows.delete(key);
      },
      async existsByKey(key) {
        return rows.has(key);
      },
      async listKeys(prefix) {
        const out: string[] = [];
        for (const k of rows.keys()) {
          if (k.startsWith(prefix)) out.push(k);
        }
        return out.sort();
      },
    };
  }

  function asBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  it("put() upserts and returns metadata", async () => {
    const ops = makeOps();
    const adapter = new PostgresStorageAdapter(ops, { baseUrl: "http://localhost:3000/files" });
    const meta = await adapter.put({ key: "k", body: asBytes("hello"), mimeType: "text/plain" });
    expect(meta).toEqual({ key: "k", sizeBytes: 5, mimeType: "text/plain" });
    expect(ops.rows.has("k")).toBe(true);
  });

  it("get() returns the stored bytes", async () => {
    const ops = makeOps();
    const adapter = new PostgresStorageAdapter(ops, { baseUrl: "http://localhost:3000/files" });
    await adapter.put({ key: "k", body: asBytes("hello"), mimeType: "text/plain" });
    expect(new TextDecoder().decode(await adapter.get("k"))).toBe("hello");
  });

  it("get() throws StorageObjectNotFoundError on miss", async () => {
    const adapter = new PostgresStorageAdapter(makeOps(), {
      baseUrl: "http://localhost:3000/files",
    });
    await expect(adapter.get("missing")).rejects.toThrow(StorageObjectNotFoundError);
  });

  it("delete() returns boolean from ops", async () => {
    const ops = makeOps();
    const adapter = new PostgresStorageAdapter(ops, { baseUrl: "http://localhost:3000/files" });
    await adapter.put({ key: "k", body: asBytes("h"), mimeType: "t/p" });
    expect(await adapter.delete("k")).toBe(true);
    expect(await adapter.delete("k")).toBe(false);
  });

  it("exists() reflects ops.existsByKey", async () => {
    const adapter = new PostgresStorageAdapter(makeOps(), {
      baseUrl: "http://localhost:3000/files",
    });
    expect(await adapter.exists("k")).toBe(false);
    await adapter.put({ key: "k", body: asBytes("h"), mimeType: "t/p" });
    expect(await adapter.exists("k")).toBe(true);
  });

  it("signUrl() returns absolute baseUrl + key + expires", async () => {
    const adapter = new PostgresStorageAdapter(makeOps(), {
      baseUrl: "http://localhost:3000/files",
    });
    await adapter.put({ key: "avatar.png", body: asBytes("p"), mimeType: "image/png" });
    const url = await adapter.signUrl("avatar.png", 600);
    expect(url.startsWith("http://localhost:3000/files")).toBe(true);
    expect(url).toContain("avatar.png");
    expect(url).toMatch(/expires=\d+/);
  });

  it("signUrl() rejects ttl <= 0 without touching ops", async () => {
    const ops = makeOps();
    const adapter = new PostgresStorageAdapter(ops, { baseUrl: "http://localhost:3000/files" });
    await expect(adapter.signUrl("k", 0)).rejects.toThrow();
  });

  it("signUrl() throws StorageObjectNotFoundError on miss", async () => {
    const adapter = new PostgresStorageAdapter(makeOps(), {
      baseUrl: "http://localhost:3000/files",
    });
    await expect(adapter.signUrl("missing", 60)).rejects.toThrow(StorageObjectNotFoundError);
  });

  it("list() returns sorted keys matching the prefix", async () => {
    const adapter = new PostgresStorageAdapter(makeOps(), {
      baseUrl: "http://localhost:3000/files",
    });
    await adapter.put({ key: "t/c.txt", body: asBytes("x"), mimeType: "t/p" });
    await adapter.put({ key: "t/a.txt", body: asBytes("x"), mimeType: "t/p" });
    await adapter.put({ key: "other/b.txt", body: asBytes("x"), mimeType: "t/p" });
    expect(await adapter.list("t/")).toEqual(["t/a.txt", "t/c.txt"]);
  });

  it("rejects empty key on put", async () => {
    const adapter = new PostgresStorageAdapter(makeOps(), {
      baseUrl: "http://localhost:3000/files",
    });
    await expect(adapter.put({ key: "", body: asBytes("x"), mimeType: "t/p" })).rejects.toThrow(
      /key/,
    );
  });

  describe("Prisma schema", () => {
    const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");
    const blockOf = (model: string): string => {
      const re = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
      const match = SCHEMA.match(re);
      expect(match, `model ${model} not found`).not.toBeNull();
      return match![0];
    };

    it("declares FileBlob model mapped to `file_blobs`", () => {
      expect(blockOf("FileBlob")).toMatch(/@@map\(\s*"file_blobs"\s*\)/);
    });

    it("FileBlob has tenant_id + unique key per (tenant_id, key)", () => {
      const block = blockOf("FileBlob");
      expect(block).toMatch(/tenantId[\s\S]*@map\(\s*"tenant_id"\s*\)/);
      expect(block).toMatch(/key\s+String/);
      expect(block).toMatch(/@@unique\(\s*\[\s*tenantId\s*,\s*key\s*\]\s*\)/);
    });

    it("FileBlob stores body as Bytes + sizeBytes + mimeType columns", () => {
      const block = blockOf("FileBlob");
      expect(block).toMatch(/body\s+Bytes/);
      expect(block).toMatch(/sizeBytes[\s\S]*@map\(\s*"size_bytes"\s*\)/);
      expect(block).toMatch(/mimeType[\s\S]*@map\(\s*"mime_type"\s*\)/);
    });
  });
});
