import { describe, expect, it } from "vitest";

import {
  PrismaFileBlobOperations,
  type PrismaFileBlobDeps,
} from "../../src/core/files/postgres-file-blob-operations.js";

/**
 * Story · Prisma binding for `FileBlobOperations`.
 *
 * Wraps `prisma.fileBlob.upsert / findUnique / delete / findMany` in
 * the FileBlobOperations interface so the PostgresStorageAdapter can
 * stay DB-agnostic. Tenant scoping is on the caller — in production
 * the adapter is constructed per-tenant via `runWithRlsTenant()`.
 */
describe("Story · Prisma FileBlobOperations binding", () => {
  type Row = { tenantId: string; key: string; mimeType: string; sizeBytes: number; body: Buffer };

  function makeDeps(tenantId: string): PrismaFileBlobDeps & { rows: Map<string, Row> } {
    const rows = new Map<string, Row>();
    return {
      get rows() {
        return rows;
      },
      tenantId,
      fileBlob: {
        async upsert({
          where,
          create,
          update,
        }: {
          where: { tenantId_key: { tenantId: string; key: string } };
          create: Row;
          update: Partial<Row>;
        }) {
          const k = `${where.tenantId_key.tenantId}/${where.tenantId_key.key}`;
          const existing = rows.get(k);
          if (existing) {
            rows.set(k, { ...existing, ...update });
          } else {
            rows.set(k, create);
          }
          return rows.get(k)!;
        },
        async findUnique({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) {
          return rows.get(`${where.tenantId_key.tenantId}/${where.tenantId_key.key}`) ?? null;
        },
        async delete({ where }: { where: { tenantId_key: { tenantId: string; key: string } } }) {
          const k = `${where.tenantId_key.tenantId}/${where.tenantId_key.key}`;
          const r = rows.get(k);
          if (!r) {
            const err = new Error("Record to delete not found.") as Error & { code: string };
            err.code = "P2025";
            throw err;
          }
          rows.delete(k);
          return r;
        },
        async findMany({ where }: { where: { tenantId: string; key: { startsWith: string } } }) {
          const out: Row[] = [];
          for (const r of rows.values()) {
            if (r.tenantId === where.tenantId && r.key.startsWith(where.key.startsWith)) {
              out.push(r);
            }
          }
          return out;
        },
      },
    } as unknown as PrismaFileBlobDeps & { rows: Map<string, Row> };
  }

  function asBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  it("upsert + findByKey roundtrip", async () => {
    const deps = makeDeps("t1");
    const ops = new PrismaFileBlobOperations(deps);
    await ops.upsert("k", asBytes("hello"), "text/plain");
    const row = await ops.findByKey("k");
    expect(row).not.toBeNull();
    expect(new TextDecoder().decode(row!.body)).toBe("hello");
    expect(row!.mimeType).toBe("text/plain");
  });

  it("upsert overwrites the body for the same key", async () => {
    const deps = makeDeps("t1");
    const ops = new PrismaFileBlobOperations(deps);
    await ops.upsert("k", asBytes("v1"), "t/p");
    await ops.upsert("k", asBytes("v2"), "t/p");
    expect(new TextDecoder().decode((await ops.findByKey("k"))!.body)).toBe("v2");
  });

  it("deleteByKey returns true on existing, false otherwise", async () => {
    const deps = makeDeps("t1");
    const ops = new PrismaFileBlobOperations(deps);
    await ops.upsert("k", asBytes("v"), "t/p");
    expect(await ops.deleteByKey("k")).toBe(true);
    expect(await ops.deleteByKey("k")).toBe(false);
  });

  it("existsByKey reflects the row presence", async () => {
    const deps = makeDeps("t1");
    const ops = new PrismaFileBlobOperations(deps);
    expect(await ops.existsByKey("k")).toBe(false);
    await ops.upsert("k", asBytes("v"), "t/p");
    expect(await ops.existsByKey("k")).toBe(true);
  });

  it("listKeys returns sorted keys matching prefix", async () => {
    const deps = makeDeps("t1");
    const ops = new PrismaFileBlobOperations(deps);
    await ops.upsert("a/b", asBytes("v"), "t/p");
    await ops.upsert("a/c", asBytes("v"), "t/p");
    await ops.upsert("z/x", asBytes("v"), "t/p");
    expect(await ops.listKeys("a/")).toEqual(["a/b", "a/c"]);
  });
});
