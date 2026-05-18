import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";

import {
  type StorageAdapter,
  type StorageObjectMetadata,
  type StoragePutInput,
  StorageObjectNotFoundError,
} from "./storage-adapter.js";
import { resolveSignSecret, signUrlToken } from "./signed-url-token.js";

/**
 * Local Storage Adapter.
 *
 * Backs the StorageAdapter contract with the local filesystem rooted
 * at `options.root`. Used in dev (when running RustFS feels heavy)
 * and in tests via a per-test temp directory.
 *
 * Path-traversal defense: every `key` is resolved against `root` and
 * the resolved path must stay inside `root`. Keys with `..` segments
 * or absolute paths are rejected before any I/O.
 */

export interface LocalStorageOptions {
  /** Absolute path of the directory that holds objects. */
  root: string;
  /** Public-facing base URL (no trailing slash) used by `signUrl()`. */
  baseUrl: string;
}

interface MetadataSidecar {
  mimeType: string;
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly driverName = "local";
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(options: LocalStorageOptions) {
    this.root = resolve(options.root);
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async put(input: StoragePutInput): Promise<StorageObjectMetadata> {
    if (!input.key) throw new Error("storage: key is required");
    const filePath = this.resolveSafe(input.key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
    await writeFile(
      this.metaPath(filePath),
      JSON.stringify({ mimeType: input.mimeType } satisfies MetadataSidecar),
    );
    return { key: input.key, sizeBytes: input.body.byteLength, mimeType: input.mimeType };
  }

  async get(key: string): Promise<Uint8Array> {
    const filePath = this.resolveSafe(key);
    if (!existsSync(filePath)) throw new StorageObjectNotFoundError(key);
    const buffer = await readFile(filePath);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }

  async delete(key: string): Promise<boolean> {
    const filePath = this.resolveSafe(key);
    if (!existsSync(filePath)) return false;
    await rm(filePath, { force: true });
    await rm(this.metaPath(filePath), { force: true });
    return true;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const filePath = this.resolveSafe(key);
      return existsSync(filePath);
    } catch {
      // Path-traversal keys never exist as far as the adapter is concerned.
      return false;
    }
  }

  async signUrl(key: string, ttlSeconds: number): Promise<string> {
    if (ttlSeconds <= 0) {
      throw new Error(`storage: ttlSeconds must be positive (received: ${ttlSeconds})`);
    }
    const filePath = this.resolveSafe(key);
    if (!existsSync(filePath)) throw new StorageObjectNotFoundError(key);
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    // CRIT-2: append an HMAC-SHA256 signature so the expiry timestamp cannot
    // be tampered with. When no secret is configured (dev-mode) the sig
    // parameter is omitted and the controller skips verification.
    const secret = resolveSignSecret();
    const sigParam = secret ? `&sig=${signUrlToken(key, expires, secret)}` : "";
    return `${this.baseUrl}/${encodePathKey(key)}?expires=${expires}${sigParam}`;
  }

  async list(prefix: string): Promise<string[]> {
    const out: string[] = [];
    await this.walk(this.root, out);
    return out
      .filter((key) => key.startsWith(prefix))
      .filter((key) => !key.endsWith(".meta.json"))
      .sort();
  }

  private async walk(dir: string, out: string[]): Promise<void> {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(abs, out);
        continue;
      }
      if (entry.isFile()) {
        // Use forward slashes in keys regardless of platform separator.
        const key = relative(this.root, abs).split(sep).join("/");
        out.push(key);
      }
    }
  }

  private resolveSafe(key: string): string {
    if (!key) throw new Error("storage: key is required");
    const normalized = normalize(key);
    if (
      normalized.startsWith("..") ||
      normalized.includes(`..${sep}`) ||
      normalized.startsWith(sep)
    ) {
      throw new Error(`storage: path traversal rejected for key "${key}"`);
    }
    const resolved = resolve(this.root, normalized);
    const rel = relative(this.root, resolved);
    if (rel.startsWith("..") || rel === ".." || rel.startsWith(`..${sep}`)) {
      throw new Error(`storage: path traversal rejected for key "${key}"`);
    }
    return resolved;
  }

  private metaPath(filePath: string): string {
    return `${filePath}.meta.json`;
  }
}

function encodePathKey(key: string): string {
  return key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function _statIfExists(filePath: string): Promise<{ size: number } | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

// keep tree-shake-friendly: re-export only via index
export type _LocalStorageInternal = typeof _statIfExists;
