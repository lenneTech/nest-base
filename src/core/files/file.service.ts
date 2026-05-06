import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * File CRUD service.
 *
 * Storage-agnostic via `FileServiceStorage`. The metadata persisted
 * here points at a key in the storage adapter — the bytes live wherever
 * the configured adapter (S3 / Local / Postgres-FileBlob) holds them.
 */

export type FileVisibility = "PRIVATE" | "PUBLIC";

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
  /**
   * Visibility marker (CF.FILES.06 — iter-113). PRIVATE is the default;
   * the share-link endpoint surfaces metadata without auth regardless,
   * but PUBLIC files can also be served by future passthrough surfaces
   * (e.g. asset-by-storage-key) that consult the visibility column.
   */
  visibility: FileVisibility;
  /**
   * Antivirus scan verdict from the FileScanner contract (CF.FILES.06).
   * Optional so existing call sites (and projects without a configured
   * `FILE_SCANNER` provider) keep working unchanged. Surfaced on the
   * read path so the admin UI can flag quarantined files visibly.
   */
  scanVerdict?: "clean" | "infected" | "indeterminate";
  /** Name of the detected threat when `scanVerdict === "infected"`. */
  scanThreatName?: string;
}

export interface FileServiceStorage {
  insert(record: FileRecord): Promise<FileRecord>;
  findById(id: string): Promise<FileRecord | null>;
  /**
   * Look up a file by id under an explicit tenant context (sets the
   * RLS `app.tenant_id` setting before the query). Used by the
   * share-link endpoint where the tenant is encoded in the HMAC
   * token rather than the request header.
   */
  findByIdInTenant(tenantId: string, id: string): Promise<FileRecord | null>;
  listByFolder(tenantId: string, folderId: string | null): Promise<FileRecord[]>;
  update(id: string, patch: Partial<FileRecord>): Promise<FileRecord | null>;
  delete(id: string): Promise<boolean>;
}

export class FileNotFoundError extends Error {
  constructor(id: string) {
    super(`file not found: ${id}`);
    this.name = "FileNotFoundError";
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
    const record: FileRecord = { id: uuidV7(), visibility: "PRIVATE", ...input };
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

  async findById(id: string): Promise<FileRecord | null> {
    return this.storage.findById(id);
  }

  async findByIdInTenant(tenantId: string, id: string): Promise<FileRecord | null> {
    return this.storage.findByIdInTenant(tenantId, id);
  }

  async setVisibility(id: string, visibility: FileVisibility): Promise<FileRecord> {
    const updated = await this.storage.update(id, { visibility });
    if (!updated) throw new FileNotFoundError(id);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const removed = await this.storage.delete(id);
    if (!removed) throw new FileNotFoundError(id);
  }
}
