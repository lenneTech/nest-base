import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FolderService,
  FolderNotFoundError,
  type FolderRecord,
  type FolderStorage,
} from "../../src/core/files/folder.service.js";
import {
  FileService,
  FileNotFoundError,
  type FileRecord,
  type FileServiceStorage,
} from "../../src/core/files/file.service.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · File/Folder CRUD (PLAN.md §8 + §32 Phase 4).
 *
 * Two services:
 *   - FolderService: nested folders per tenant (parentId NULL = root)
 *   - FileService:   file metadata pointing at a storage key
 *
 * Storage-agnostic via interfaces; the Prisma adapter lives next to
 * PrismaService.
 */
describe("Story · File/Folder CRUD", () => {
  function folderStorage(): FolderStorage & { records: FolderRecord[] } {
    const records: FolderRecord[] = [];
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
      async listByParent(tenantId, parentId) {
        return records.filter((r) => r.tenantId === tenantId && r.parentId === parentId);
      },
      async update(id, patch) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return null;
        records[idx] = { ...records[idx]!, ...patch };
        return records[idx]!;
      },
      async delete(id) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return false;
        records.splice(idx, 1);
        return true;
      },
    };
  }

  function fileStorage(): FileServiceStorage & { records: FileRecord[] } {
    const records: FileRecord[] = [];
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
      async listByFolder(tenantId, folderId) {
        return records.filter((r) => r.tenantId === tenantId && r.folderId === folderId);
      },
      async update(id, patch) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return null;
        records[idx] = { ...records[idx]!, ...patch };
        return records[idx]!;
      },
      async delete(id) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return false;
        records.splice(idx, 1);
        return true;
      },
    };
  }

  describe("FolderService", () => {
    it("create() makes a root folder when parentId=null", async () => {
      const svc = new FolderService(folderStorage());
      const folder = await svc.create({ tenantId: "t1", name: "docs", parentId: null });
      expect(folder.parentId).toBeNull();
      expect(folder.name).toBe("docs");
      expect(folder.tenantId).toBe("t1");
    });

    it("create() makes a nested folder when parentId points at an existing folder", async () => {
      const storage = folderStorage();
      const svc = new FolderService(storage);
      const root = await svc.create({ tenantId: "t1", name: "docs", parentId: null });
      const child = await svc.create({ tenantId: "t1", name: "q1", parentId: root.id });
      expect(child.parentId).toBe(root.id);
    });

    it("rename() updates the folder name", async () => {
      const svc = new FolderService(folderStorage());
      const folder = await svc.create({ tenantId: "t1", name: "old", parentId: null });
      const renamed = await svc.rename(folder.id, "new");
      expect(renamed.name).toBe("new");
    });

    it("rename() throws FolderNotFoundError on missing id", async () => {
      const svc = new FolderService(folderStorage());
      await expect(svc.rename("missing", "x")).rejects.toThrow(FolderNotFoundError);
    });

    it("listChildren() returns only the children of the given parent", async () => {
      const svc = new FolderService(folderStorage());
      const root = await svc.create({ tenantId: "t1", name: "root", parentId: null });
      await svc.create({ tenantId: "t1", name: "a", parentId: root.id });
      await svc.create({ tenantId: "t1", name: "b", parentId: root.id });
      const otherRoot = await svc.create({ tenantId: "t2", name: "root", parentId: null });
      await svc.create({ tenantId: "t2", name: "x", parentId: otherRoot.id });

      const children = await svc.listChildren("t1", root.id);
      expect(children.map((c) => c.name).sort()).toEqual(["a", "b"]);
    });

    it("remove() drops the folder by id", async () => {
      const storage = folderStorage();
      const svc = new FolderService(storage);
      const folder = await svc.create({ tenantId: "t1", name: "gone", parentId: null });
      await svc.remove(folder.id);
      expect(storage.records).toHaveLength(0);
    });
  });

  describe("FileService", () => {
    it("create() persists metadata and returns the record", async () => {
      const svc = new FileService(fileStorage());
      const file = await svc.create({
        tenantId: "t1",
        folderId: null,
        filename: "avatar.png",
        mimeType: "image/png",
        sizeBytes: 100,
        sha256: "0".repeat(64),
        storageDriver: "s3",
        storageKey: "t1/avatar.png",
        uploaderId: "u1",
      });
      expect(file.filename).toBe("avatar.png");
      expect(file.mimeType).toBe("image/png");
    });

    it("rename() changes the filename", async () => {
      const svc = new FileService(fileStorage());
      const file = await svc.create({
        tenantId: "t1",
        folderId: null,
        filename: "old.png",
        mimeType: "image/png",
        sizeBytes: 1,
        sha256: "0".repeat(64),
        storageDriver: "s3",
        storageKey: "k",
        uploaderId: "u1",
      });
      const renamed = await svc.rename(file.id, "new.png");
      expect(renamed.filename).toBe("new.png");
    });

    it("listInFolder() filters by tenant + folder", async () => {
      const svc = new FileService(fileStorage());
      const folderId = "019dd4ce-5025-7a98-8fe6-ee8f4a31c2d1";
      await svc.create({
        tenantId: "t1",
        folderId,
        filename: "a.png",
        mimeType: "image/png",
        sizeBytes: 1,
        sha256: "0".repeat(64),
        storageDriver: "s3",
        storageKey: "k1",
        uploaderId: "u1",
      });
      await svc.create({
        tenantId: "t1",
        folderId,
        filename: "b.png",
        mimeType: "image/png",
        sizeBytes: 1,
        sha256: "1".repeat(64),
        storageDriver: "s3",
        storageKey: "k2",
        uploaderId: "u1",
      });
      await svc.create({
        tenantId: "t1",
        folderId: null,
        filename: "c.png",
        mimeType: "image/png",
        sizeBytes: 1,
        sha256: "2".repeat(64),
        storageDriver: "s3",
        storageKey: "k3",
        uploaderId: "u1",
      });

      const list = await svc.listInFolder("t1", folderId);
      expect(list.map((f) => f.filename).sort()).toEqual(["a.png", "b.png"]);
    });

    it("remove() deletes the file record", async () => {
      const storage = fileStorage();
      const svc = new FileService(storage);
      const file = await svc.create({
        tenantId: "t1",
        folderId: null,
        filename: "gone.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        sha256: "0".repeat(64),
        storageDriver: "s3",
        storageKey: "k",
        uploaderId: "u1",
      });
      await svc.remove(file.id);
      expect(storage.records).toHaveLength(0);
    });

    it("rename() / remove() throw FileNotFoundError on missing id", async () => {
      const svc = new FileService(fileStorage());
      await expect(svc.rename("missing", "x")).rejects.toThrow(FileNotFoundError);
      await expect(svc.remove("missing")).rejects.toThrow(FileNotFoundError);
    });
  });

  describe("Prisma schema", () => {
    const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");
    const blockOf = (model: string): string => {
      const re = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
      const match = SCHEMA.match(re);
      expect(match, `model ${model} not found`).not.toBeNull();
      return match![0];
    };

    it("declares Folder model mapped to `folders`", () => {
      const block = blockOf("Folder");
      expect(block).toMatch(/@@map\(\s*"folders"\s*\)/);
      expect(block).toMatch(/parentId[\s\S]*@map\(\s*"parent_id"\s*\)/);
      expect(block).toMatch(/tenantId[\s\S]*@map\(\s*"tenant_id"\s*\)/);
    });

    it("declares File model mapped to `files`", () => {
      const block = blockOf("File");
      expect(block).toMatch(/@@map\(\s*"files"\s*\)/);
      expect(block).toMatch(/storageDriver[\s\S]*@map\(\s*"storage_driver"\s*\)/);
      expect(block).toMatch(/storageKey[\s\S]*@map\(\s*"storage_key"\s*\)/);
      expect(block).toMatch(/sizeBytes[\s\S]*@map\(\s*"size_bytes"\s*\)/);
    });
  });
});
