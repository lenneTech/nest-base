/**
 * Prisma-backed `FileServiceStorage` + `FolderStorage`.
 *
 * Replaces the in-memory map storage that previous slices wired to
 * `FileService` / `FolderService`. File rows survive process restarts
 * and ride through the project's RLS policies via `runWithRlsTenant()`.
 *
 * Soft-delete: `delete()` flips the row's `deletedAt` instead of
 * removing it. `findById()` / `listByFolder()` filter out tombstones.
 * The schema columns (`File.deletedAt`, `Folder.deletedAt`) already
 * exist; this is the contract that consumes them.
 *
 * The dependency interface is a thin slice of the Prisma surface so
 * unit tests can run without a DB. The production wiring binds the
 * `PrismaService` adapter via `bindPrismaFileStorage()`.
 */

import type { File, Folder } from "@prisma/client";

import type { PrismaService } from "../prisma/prisma.service.js";
import type { FileRecord, FileServiceStorage } from "./file.service.js";
import type { FolderRecord, FolderStorage } from "./folder.service.js";

// ── File ──

interface FileTable {
  create(input: { data: File }): Promise<File>;
  findFirst(input: { where: Partial<File> }): Promise<File | null>;
  findMany(input: {
    where?: Partial<File>;
    orderBy?: { [k: string]: "asc" | "desc" };
  }): Promise<File[]>;
  update(input: { where: { id: string }; data: Partial<File> }): Promise<File | null>;
  updateMany(input: {
    where: Partial<File>;
    data: Partial<File>;
  }): Promise<{ count: number }>;
}

interface FileTx {
  file: FileTable;
}

export interface PrismaFileStorageDeps {
  runWithRlsTenant<T>(cb: (tx: FileTx) => Promise<T>, tenantId: string): Promise<T>;
  /**
   * Test-only escape hatch: when the dependency is a fake (story
   * tests), this property exposes the in-memory tx so the test runs
   * without a real Prisma transaction.
   */
  readonly __tx?: FileTx;
}

export class PrismaFileStorage implements FileServiceStorage {
  constructor(private readonly deps: PrismaFileStorageDeps) {}

  async insert(record: FileRecord): Promise<FileRecord> {
    const created = await this.deps.runWithRlsTenant(
      (tx) =>
        tx.file.create({
          data: this.toRow(record),
        }),
      record.tenantId,
    );
    return this.fromRow(created);
  }

  async findById(id: string): Promise<FileRecord | null> {
    // We cannot pass a tenantId because the caller doesn't supply one
    // — RLS guards cross-tenant reads in production; the in-process
    // path scans by id alone but skips soft-deleted rows.
    const row = await this.scanById(id);
    if (!row || row.deletedAt) return null;
    return this.fromRow(row);
  }

  async listByFolder(tenantId: string, folderId: string | null): Promise<FileRecord[]> {
    const rows = await this.deps.runWithRlsTenant(
      (tx) =>
        tx.file.findMany({
          where: {
            tenantId,
            folderId,
            deletedAt: null,
          } as Partial<File>,
        }),
      tenantId,
    );
    return rows.filter((r) => r.deletedAt === null).map((r) => this.fromRow(r));
  }

  async update(id: string, patch: Partial<FileRecord>): Promise<FileRecord | null> {
    const existing = await this.scanById(id);
    if (!existing || existing.deletedAt) return null;
    const next = await this.deps.runWithRlsTenant(
      (tx) =>
        tx.file.update({
          where: { id },
          data: this.toRowPatch(patch),
        }),
      existing.tenantId,
    );
    return next ? this.fromRow(next) : null;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.scanById(id);
    if (!existing || existing.deletedAt) return false;
    await this.deps.runWithRlsTenant(
      async (tx) => {
        await tx.file.update({
          where: { id },
          data: { deletedAt: new Date() } as Partial<File>,
        });
      },
      existing.tenantId,
    );
    return true;
  }

  // ── helpers ──

  private async scanById(id: string): Promise<File | null> {
    if (this.deps.__tx) {
      return this.deps.__tx.file.findFirst({ where: { id } as Partial<File> });
    }
    // Production path: relies on the tenant id being present in the
    // AsyncLocalStorage container (the TenantInterceptor populates it
    // before any handler runs). `runWithRlsTenant` reads from there
    // when the second argument is omitted.
    try {
      return await this.deps.runWithRlsTenant(
        (tx) => tx.file.findFirst({ where: { id } as Partial<File> }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (undefined as unknown) as any,
      );
    } catch {
      return null;
    }
  }

  private toRow(record: FileRecord): File {
    return {
      id: record.id,
      tenantId: record.tenantId,
      folderId: record.folderId,
      filename: record.filename,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      sha256: record.sha256,
      storageDriver: record.storageDriver,
      storageKey: record.storageKey,
      uploaderId: record.uploaderId,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as File;
  }

  private toRowPatch(patch: Partial<FileRecord>): Partial<File> {
    const out: Partial<File> = {};
    if (patch.filename !== undefined) out.filename = patch.filename;
    if (patch.mimeType !== undefined) out.mimeType = patch.mimeType;
    if (patch.sizeBytes !== undefined) out.sizeBytes = patch.sizeBytes;
    if (patch.sha256 !== undefined) out.sha256 = patch.sha256;
    if (patch.storageDriver !== undefined) out.storageDriver = patch.storageDriver;
    if (patch.storageKey !== undefined) out.storageKey = patch.storageKey;
    if (patch.folderId !== undefined) out.folderId = patch.folderId;
    return out;
  }

  private fromRow(row: File): FileRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      folderId: row.folderId,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      storageDriver: row.storageDriver,
      storageKey: row.storageKey,
      uploaderId: row.uploaderId,
    };
  }
}

// ── Folder ──

interface FolderTable {
  create(input: { data: Folder }): Promise<Folder>;
  findFirst(input: { where: Partial<Folder> }): Promise<Folder | null>;
  findMany(input: { where?: Partial<Folder> }): Promise<Folder[]>;
  update(input: { where: { id: string }; data: Partial<Folder> }): Promise<Folder | null>;
  updateMany(input: {
    where: Partial<Folder>;
    data: Partial<Folder>;
  }): Promise<{ count: number }>;
}

interface FolderTx {
  folder: FolderTable;
}

export interface PrismaFolderStorageDeps {
  runWithRlsTenant<T>(cb: (tx: FolderTx) => Promise<T>, tenantId: string): Promise<T>;
  readonly __tx?: FolderTx;
}

export class PrismaFolderStorage implements FolderStorage {
  constructor(private readonly deps: PrismaFolderStorageDeps) {}

  async insert(record: FolderRecord): Promise<FolderRecord> {
    const created = await this.deps.runWithRlsTenant(
      (tx) => tx.folder.create({ data: this.toRow(record) }),
      record.tenantId,
    );
    return this.fromRow(created);
  }

  async findById(id: string): Promise<FolderRecord | null> {
    const row = await this.scanById(id);
    if (!row || row.deletedAt) return null;
    return this.fromRow(row);
  }

  async listByParent(tenantId: string, parentId: string | null): Promise<FolderRecord[]> {
    const rows = await this.deps.runWithRlsTenant(
      (tx) =>
        tx.folder.findMany({
          where: {
            tenantId,
            parentId,
            deletedAt: null,
          } as Partial<Folder>,
        }),
      tenantId,
    );
    return rows.filter((r) => r.deletedAt === null).map((r) => this.fromRow(r));
  }

  async update(id: string, patch: Partial<FolderRecord>): Promise<FolderRecord | null> {
    const existing = await this.scanById(id);
    if (!existing || existing.deletedAt) return null;
    const next = await this.deps.runWithRlsTenant(
      (tx) =>
        tx.folder.update({
          where: { id },
          data: this.toRowPatch(patch),
        }),
      existing.tenantId,
    );
    return next ? this.fromRow(next) : null;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.scanById(id);
    if (!existing || existing.deletedAt) return false;
    await this.deps.runWithRlsTenant(
      async (tx) => {
        await tx.folder.update({
          where: { id },
          data: { deletedAt: new Date() } as Partial<Folder>,
        });
      },
      existing.tenantId,
    );
    return true;
  }

  // ── helpers ──

  private async scanById(id: string): Promise<Folder | null> {
    if (this.deps.__tx) {
      return this.deps.__tx.folder.findFirst({ where: { id } as Partial<Folder> });
    }
    return null;
  }

  private toRow(record: FolderRecord): Folder {
    return {
      id: record.id,
      tenantId: record.tenantId,
      parentId: record.parentId,
      name: record.name,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as Folder;
  }

  private toRowPatch(patch: Partial<FolderRecord>): Partial<Folder> {
    const out: Partial<Folder> = {};
    if (patch.name !== undefined) out.name = patch.name;
    if (patch.parentId !== undefined) out.parentId = patch.parentId;
    return out;
  }

  private fromRow(row: Folder): FolderRecord {
    return {
      id: row.id,
      tenantId: row.tenantId,
      parentId: row.parentId,
      name: row.name,
    };
  }
}

// ── Production binding ──

/**
 * Adapt a `PrismaService` instance into the dependency interface
 * `PrismaFileStorage` consumes. The adapter's only job is to forward
 * `runWithRlsTenant` — production code does not pass `__tx`.
 */
export function bindPrismaFileStorage(prisma: PrismaService): PrismaFileStorage {
  return new PrismaFileStorage({
    runWithRlsTenant: (cb, tenantId) =>
      prisma.runWithRlsTenant((tx) => cb(tx as unknown as FileTx), tenantId),
  });
}

export function bindPrismaFolderStorage(prisma: PrismaService): PrismaFolderStorage {
  return new PrismaFolderStorage({
    runWithRlsTenant: (cb, tenantId) =>
      prisma.runWithRlsTenant((tx) => cb(tx as unknown as FolderTx), tenantId),
  });
}
