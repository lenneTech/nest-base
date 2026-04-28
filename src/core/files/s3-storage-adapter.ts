import {
  type StorageAdapter,
  type StorageObjectMetadata,
  type StoragePutInput,
  StorageObjectNotFoundError,
} from './storage-adapter.js';

/**
 * S3 Storage Adapter (PLAN.md §8 + §32 Phase 4).
 *
 * Implements the StorageAdapter contract against any S3-API-compatible
 * backend (RustFS, AWS S3, Cloudflare R2, Backblaze B2, …).
 *
 * The adapter takes a thin `S3Operations` interface so unit tests stay
 * AWS-SDK-free; the production binding (`AwsS3Operations`, wired in
 * the storage-module slice) wraps `@aws-sdk/client-s3` +
 * `@aws-sdk/s3-request-presigner`.
 */

export interface S3GetResult {
  body: Uint8Array;
  mimeType: string;
}

export interface S3Operations {
  putObject(key: string, body: Uint8Array, mimeType: string): Promise<void>;
  getObject(key: string): Promise<S3GetResult | null>;
  deleteObject(key: string): Promise<boolean>;
  headObject(key: string): Promise<boolean>;
  listObjects(prefix: string): Promise<string[]>;
  presignGet(key: string, ttlSeconds: number): Promise<string>;
}

export class S3StorageAdapter implements StorageAdapter {
  constructor(private readonly ops: S3Operations) {}

  async put(input: StoragePutInput): Promise<StorageObjectMetadata> {
    if (!input.key) throw new Error('storage: key is required');
    await this.ops.putObject(input.key, input.body, input.mimeType);
    return { key: input.key, sizeBytes: input.body.byteLength, mimeType: input.mimeType };
  }

  async get(key: string): Promise<Uint8Array> {
    const result = await this.ops.getObject(key);
    if (!result) throw new StorageObjectNotFoundError(key);
    return result.body;
  }

  async delete(key: string): Promise<boolean> {
    return this.ops.deleteObject(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.ops.headObject(key);
  }

  async signUrl(key: string, ttlSeconds: number): Promise<string> {
    if (ttlSeconds <= 0) {
      throw new Error(`storage: ttlSeconds must be positive (received: ${ttlSeconds})`);
    }
    if (!(await this.ops.headObject(key))) {
      throw new StorageObjectNotFoundError(key);
    }
    return this.ops.presignGet(key, ttlSeconds);
  }

  async list(prefix: string): Promise<string[]> {
    return this.ops.listObjects(prefix);
  }
}
