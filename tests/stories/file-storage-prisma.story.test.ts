import { describe, expect, it } from "vitest";

import {
  PrismaFileStorage,
  PrismaFolderStorage,
  type PrismaFileStorageDeps,
  type PrismaFolderStorageDeps,
} from "../../src/core/files/file-storage.prisma.js";

/**
 * Story · Prisma File / Folder Storage.
 *
 * Production binding for `FileServiceStorage` + `FolderStorage` against
 * the Prisma `File` and `Folder` models. The injectable `Prisma`-shape
 * dependency lets unit tests run without a real DB; the production
 * wiring passes a `PrismaService` adapter.
 *
 * Tenant isolation: every read filters by `tenantId`. The `tenantId`
 * also rides through `runWithRlsTenant()` in production so the RLS
 * policies double-down on isolation; this story pins the in-process
 * filtering invariant.
 */
describe("Story · PrismaFileStorage", () => {
  type FileRow = {
    id: string;
    tenantId: string;
    folderId: string | null;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    storageDriver: string;
    storageKey: string;
    uploaderId: string;
    deletedAt: Date | null;
  };

  function makeFakeFiles(): PrismaFileStorageDeps & { rows: Map<string, FileRow> } {
    const rows = new Map<string, FileRow>();
    const matches = (row: FileRow, where: Record<string, unknown>): boolean => {
      for (const [k, v] of Object.entries(where)) {
        if ((row as Record<string, unknown>)[k] !== v) return false;
      }
      return true;
    };
    return {
      get rows() {
        return rows;
      },
      async runWithRlsTenant<T>(
        cb: (tx: PrismaFileStorageDeps["__tx"]) => Promise<T>,
        _tenantId: string,
      ): Promise<T> {
        return cb(this.__tx);
      },
      __tx: {
        file: {
          async create({ data }: { data: FileRow }) {
            const row: FileRow = { ...data, deletedAt: null };
            rows.set(row.id, row);
            return row;
          },
          async findFirst({ where }: { where: Record<string, unknown> }) {
            for (const r of rows.values()) {
              if (matches(r, where)) return r;
            }
            return null;
          },
          async findMany({
            where,
            orderBy: _orderBy,
          }: {
            where?: Record<string, unknown>;
            orderBy?: unknown;
          }) {
            const out: FileRow[] = [];
            for (const r of rows.values()) {
              if (!where || matches(r, where)) out.push(r);
            }
            return out;
          },
          async update({ where, data }: { where: { id: string }; data: Partial<FileRow> }) {
            const existing = rows.get(where.id);
            if (!existing) return null;
            const next = { ...existing, ...data };
            rows.set(next.id, next);
            return next;
          },
          async updateMany({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Partial<FileRow>;
          }) {
            let count = 0;
            for (const [id, row] of rows) {
              if (matches(row, where)) {
                rows.set(id, { ...row, ...data });
                count += 1;
              }
            }
            return { count };
          },
        },
      },
    } as PrismaFileStorageDeps & { rows: Map<string, FileRow> };
  }

  it("insert() persists the record and returns it", async () => {
    const fake = makeFakeFiles();
    const storage = new PrismaFileStorage(fake);
    const result = await storage.insert({
      id: "id1",
      tenantId: "t1",
      folderId: null,
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      storageDriver: "local",
      storageKey: "k",
      uploaderId: "u1",
    });
    expect(result.filename).toBe("a.png");
    expect(fake.rows.has("id1")).toBe(true);
  });

  it("findById() returns only non-deleted rows", async () => {
    const fake = makeFakeFiles();
    const storage = new PrismaFileStorage(fake);
    await storage.insert({
      id: "id1",
      tenantId: "t1",
      folderId: null,
      filename: "a.png",
      mimeType: "image/png",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      storageDriver: "local",
      storageKey: "k",
      uploaderId: "u1",
    });
    expect(await storage.findById("id1")).not.toBeNull();
    await storage.delete("id1");
    expect(await storage.findById("id1")).toBeNull();
  });

  it("listByFolder() filters by tenantId + folderId", async () => {
    const fake = makeFakeFiles();
    const storage = new PrismaFileStorage(fake);
    await storage.insert({
      id: "1",
      tenantId: "t1",
      folderId: "f1",
      filename: "a",
      mimeType: "x",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      storageDriver: "local",
      storageKey: "k1",
      uploaderId: "u1",
    });
    await storage.insert({
      id: "2",
      tenantId: "t1",
      folderId: "f2",
      filename: "b",
      mimeType: "x",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      storageDriver: "local",
      storageKey: "k2",
      uploaderId: "u1",
    });
    await storage.insert({
      id: "3",
      tenantId: "t2",
      folderId: "f1",
      filename: "c",
      mimeType: "x",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      storageDriver: "local",
      storageKey: "k3",
      uploaderId: "u1",
    });
    const rows = await storage.listByFolder("t1", "f1");
    expect(rows.map((r) => r.id)).toEqual(["1"]);
  });

  it("update() patches the row", async () => {
    const fake = makeFakeFiles();
    const storage = new PrismaFileStorage(fake);
    await storage.insert({
      id: "1",
      tenantId: "t1",
      folderId: null,
      filename: "old",
      mimeType: "x",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      storageDriver: "local",
      storageKey: "k",
      uploaderId: "u1",
    });
    const updated = await storage.update("1", { filename: "new" });
    expect(updated?.filename).toBe("new");
  });

  it("update() returns null on missing id", async () => {
    const storage = new PrismaFileStorage(makeFakeFiles());
    expect(await storage.update("missing", { filename: "x" })).toBeNull();
  });

  it("delete() soft-deletes (returns true once)", async () => {
    const fake = makeFakeFiles();
    const storage = new PrismaFileStorage(fake);
    await storage.insert({
      id: "1",
      tenantId: "t1",
      folderId: null,
      filename: "x",
      mimeType: "x",
      sizeBytes: 1,
      sha256: "0".repeat(64),
      storageDriver: "local",
      storageKey: "k",
      uploaderId: "u1",
    });
    expect(await storage.delete("1")).toBe(true);
    // Soft-deleted: row still present in the table but findById skips it.
    expect(await storage.findById("1")).toBeNull();
    expect(await storage.delete("1")).toBe(false);
  });
});

describe("Story · PrismaFolderStorage", () => {
  type FolderRow = {
    id: string;
    tenantId: string;
    parentId: string | null;
    name: string;
    deletedAt: Date | null;
  };

  function makeFakeFolders(): PrismaFolderStorageDeps & { rows: Map<string, FolderRow> } {
    const rows = new Map<string, FolderRow>();
    const matches = (row: FolderRow, where: Record<string, unknown>): boolean => {
      for (const [k, v] of Object.entries(where)) {
        if ((row as Record<string, unknown>)[k] !== v) return false;
      }
      return true;
    };
    return {
      get rows() {
        return rows;
      },
      async runWithRlsTenant<T>(
        cb: (tx: PrismaFolderStorageDeps["__tx"]) => Promise<T>,
      ): Promise<T> {
        return cb(this.__tx);
      },
      __tx: {
        folder: {
          async create({ data }: { data: FolderRow }) {
            const row: FolderRow = { ...data, deletedAt: null };
            rows.set(row.id, row);
            return row;
          },
          async findFirst({ where }: { where: Record<string, unknown> }) {
            for (const r of rows.values()) {
              if (matches(r, where)) return r;
            }
            return null;
          },
          async findMany({ where }: { where?: Record<string, unknown> }) {
            const out: FolderRow[] = [];
            for (const r of rows.values()) {
              if (!where || matches(r, where)) out.push(r);
            }
            return out;
          },
          async update({ where, data }: { where: { id: string }; data: Partial<FolderRow> }) {
            const existing = rows.get(where.id);
            if (!existing) return null;
            const next = { ...existing, ...data };
            rows.set(next.id, next);
            return next;
          },
          async updateMany({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Partial<FolderRow>;
          }) {
            let count = 0;
            for (const [id, row] of rows) {
              if (matches(row, where)) {
                rows.set(id, { ...row, ...data });
                count += 1;
              }
            }
            return { count };
          },
        },
      },
    } as PrismaFolderStorageDeps & { rows: Map<string, FolderRow> };
  }

  it("insert + listByParent + delete roundtrip", async () => {
    const fake = makeFakeFolders();
    const storage = new PrismaFolderStorage(fake);
    await storage.insert({ id: "f1", tenantId: "t1", parentId: null, name: "docs" });
    await storage.insert({ id: "f2", tenantId: "t1", parentId: "f1", name: "q1" });
    await storage.insert({ id: "f3", tenantId: "t2", parentId: null, name: "docs" });

    expect((await storage.listByParent("t1", null)).map((r) => r.id)).toEqual(["f1"]);
    expect((await storage.listByParent("t1", "f1")).map((r) => r.id)).toEqual(["f2"]);
    expect(await storage.delete("f1")).toBe(true);
    expect(await storage.findById("f1")).toBeNull();
  });
});
