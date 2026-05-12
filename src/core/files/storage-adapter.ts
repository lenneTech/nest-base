/**
 * Storage adapter interface.
 *
 * The contract every storage backend implements: S3 (RustFS, AWS,
 * Cloudflare R2, …), Local-FS, Postgres Large Objects. The
 * `InMemoryStorageAdapter` here is the reference implementation that
 * tests + dev tooling consume; the real backends ship in their own
 * slices and are tested through the same contract.
 */

export interface StorageObjectMetadata {
  key: string;
  sizeBytes: number;
  mimeType: string;
}

export interface StoragePutInput {
  key: string;
  body: Uint8Array;
  mimeType: string;
}

export interface StorageAdapter {
  /**
   * Stable driver name used by `detectDriverName()` (H3/L2 fix).
   * Storing this on the instance avoids relying on `constructor.name`
   * which may be mangled by minifiers in production builds.
   */
  readonly driverName: string;
  put(input: StoragePutInput): Promise<StorageObjectMetadata>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  signUrl(key: string, ttlSeconds: number): Promise<string>;
  list(prefix: string): Promise<string[]>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`storage: object not found at key "${key}"`);
    this.name = "StorageObjectNotFoundError";
  }
}

interface StoredObject {
  body: Uint8Array;
  mimeType: string;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  readonly driverName = "memory";
  private readonly objects = new Map<string, StoredObject>();

  async put(input: StoragePutInput): Promise<StorageObjectMetadata> {
    if (!input.key) throw new Error("storage: key is required");
    this.objects.set(input.key, { body: input.body, mimeType: input.mimeType });
    return { key: input.key, sizeBytes: input.body.byteLength, mimeType: input.mimeType };
  }

  async get(key: string): Promise<Uint8Array> {
    const entry = this.objects.get(key);
    if (!entry) throw new StorageObjectNotFoundError(key);
    return entry.body;
  }

  async delete(key: string): Promise<boolean> {
    return this.objects.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async signUrl(key: string, ttlSeconds: number): Promise<string> {
    if (ttlSeconds <= 0)
      throw new Error(`storage: ttlSeconds must be positive (received: ${ttlSeconds})`);
    if (!this.objects.has(key)) throw new StorageObjectNotFoundError(key);
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    return `memory://${encodeURIComponent(key)}?expires=${expires}`;
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) out.push(key);
    }
    return out.sort();
  }
}
