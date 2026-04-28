import { uuidV7 } from '../uuid/uuid-v7.js';

/**
 * File CRUD service (PLAN.md §8 + §32 Phase 4).
 *
 * Storage-agnostic via `FileServiceStorage`. The metadata persisted
 * here points at a key in the storage adapter — the bytes live wherever
 * the configured adapter (S3 / Local / Postgres-FileBlob) holds them.
 */

export interface FileRecord {
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
}

export interface FileServiceStorage {
  insert(record: FileRecord): Promise<FileRecord>;
  findById(id: string): Promise<FileRecord | null>;
  listByFolder(tenantId: string, folderId: string | null): Promise<FileRecord[]>;
  update(id: string, patch: Partial<FileRecord>): Promise<FileRecord | null>;
  delete(id: string): Promise<boolean>;
}

export class FileNotFoundError extends Error {
  constructor(id: string) {
    super(`file not found: ${id}`);
    this.name = 'FileNotFoundError';
  }
}

export interface CreateFileInput {
  tenantId: string;
  folderId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageDriver: string;
  storageKey: string;
  uploaderId: string;
}

export class FileService {
  constructor(private readonly storage: FileServiceStorage) {}

  async create(input: CreateFileInput): Promise<FileRecord> {
    const record: FileRecord = { id: uuidV7(), ...input };
    return this.storage.insert(record);
  }

  async rename(id: string, filename: string): Promise<FileRecord> {
    const updated = await this.storage.update(id, { filename });
    if (!updated) throw new FileNotFoundError(id);
    return updated;
  }

  async listInFolder(tenantId: string, folderId: string | null): Promise<FileRecord[]> {
    return this.storage.listByFolder(tenantId, folderId);
  }

  async remove(id: string): Promise<void> {
    const removed = await this.storage.delete(id);
    if (!removed) throw new FileNotFoundError(id);
  }
}
