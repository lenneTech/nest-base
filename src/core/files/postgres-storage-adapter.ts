import {
  type StorageAdapter,
  type StorageObjectMetadata,
  type StoragePutInput,
  StorageObjectNotFoundError,
} from './storage-adapter.js';

/**
 * Postgres Storage Adapter (PLAN.md §8 + §32 Phase 4).
 *
 * Backs the StorageAdapter contract with the `FileBlob` Prisma model.
 * Tenant isolation rides the existing RLS policies (iteration 23) so
 * a malformed query can't read across tenants.
 *
 * The injectable `FileBlobOperations` shape lets unit tests run
 * without a real Prisma client; the production binding wraps
 * `prisma.fileBlob.upsert / findUnique / delete / findMany`.
 */

export interface FileBlobRow {
  mimeType: string;
  body: Uint8Array;
}

export interface FileBlobOperations {
  upsert(key: string, body: Uint8Array, mimeType: string): Promise<void>;
  findByKey(key: string): Promise<FileBlobRow | null>;
  deleteByKey(key: string): Promise<boolean>;
  existsByKey(key: string): Promise<boolean>;
  listKeys(prefix: string): Promise<string[]>;
}

export interface PostgresStorageOptions {
  /** Public-facing base URL (no trailing slash) used by `signUrl()`. */
  baseUrl: string;
}

export class PostgresStorageAdapter implements StorageAdapter {
  private readonly baseUrl: string;

  constructor(
    private readonly ops: FileBlobOperations,
    options: PostgresStorageOptions,
  ) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }

  async put(input: StoragePutInput): Promise<StorageObjectMetadata> {
    if (!input.key) throw new Error('storage: key is required');
    await this.ops.upsert(input.key, input.body, input.mimeType);
    return { key: input.key, sizeBytes: input.body.byteLength, mimeType: input.mimeType };
  }

  async get(key: string): Promise<Uint8Array> {
    const row = await this.ops.findByKey(key);
    if (!row) throw new StorageObjectNotFoundError(key);
    return row.body;
  }

  async delete(key: string): Promise<boolean> {
    return this.ops.deleteByKey(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.ops.existsByKey(key);
  }

  async signUrl(key: string, ttlSeconds: number): Promise<string> {
    if (ttlSeconds <= 0) {
      throw new Error(`storage: ttlSeconds must be positive (received: ${ttlSeconds})`);
    }
    if (!(await this.ops.existsByKey(key))) {
      throw new StorageObjectNotFoundError(key);
    }
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `${this.baseUrl}/${encodePathKey(key)}?expires=${expires}`;
  }

  async list(prefix: string): Promise<string[]> {
    const keys = await this.ops.listKeys(prefix);
    return keys.slice().sort();
  }
}

function encodePathKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}
