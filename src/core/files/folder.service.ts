import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * Folder CRUD service.
 *
 * Storage-agnostic via `FolderStorage` so unit tests skip Prisma.
 * Folders are tenant-scoped (`tenantId` mandatory) and can nest via
 * `parentId` (NULL = root). Hierarchical-validation (parent must be
 * in the same tenant, no cycles) is enforced by the Prisma adapter
 * binding once it lands; this service owns the in-process surface.
 */

export interface FolderRecord {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
}

export interface FolderStorage {
  insert(record: FolderRecord): Promise<FolderRecord>;
  findById(id: string): Promise<FolderRecord | null>;
  listByParent(tenantId: string, parentId: string | null): Promise<FolderRecord[]>;
  update(id: string, patch: Partial<FolderRecord>): Promise<FolderRecord | null>;
  delete(id: string): Promise<boolean>;
}

export class FolderNotFoundError extends Error {
  constructor(id: string) {
    super(`folder not found: ${id}`);
    this.name = "FolderNotFoundError";
  }
}

export interface CreateFolderInput {
  tenantId: string;
  name: string;
  parentId: string | null;
}

export class FolderService {
  constructor(private readonly storage: FolderStorage) {}

  async create(input: CreateFolderInput): Promise<FolderRecord> {
    const record: FolderRecord = {
      id: uuidV7(),
      tenantId: input.tenantId,
      parentId: input.parentId,
      name: input.name,
    };
    return this.storage.insert(record);
  }

  async rename(id: string, name: string): Promise<FolderRecord> {
    const updated = await this.storage.update(id, { name });
    if (!updated) throw new FolderNotFoundError(id);
    return updated;
  }

  async listChildren(tenantId: string, parentId: string | null): Promise<FolderRecord[]> {
    return this.storage.listByParent(tenantId, parentId);
  }

  async remove(id: string): Promise<void> {
    const removed = await this.storage.delete(id);
    if (!removed) throw new FolderNotFoundError(id);
  }
}
