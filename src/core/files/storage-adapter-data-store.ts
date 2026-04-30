/**
 * `@tus/server` `DataStore` adapter that delegates to a `StorageAdapter`.
 *
 * The TUS protocol is HTTP-shaped (POST creates, HEAD reads offset,
 * PATCH appends bytes at the current offset, DELETE aborts). The
 * `@tus/server` library calls the four methods below; this wrapper
 * forwards them onto a `StorageAdapter` so an in-progress upload sits
 * in the same backend that finished files do (S3 / Local / Postgres).
 *
 * In-progress chunks are stored under the `_tus/` prefix so a `list("_tus/")`
 * sweep can purge stale uploads (`chunkExpirationSeconds`). The
 * upload-complete hook is responsible for moving the bytes from
 * `_tus/<id>` to the final `<tenant>/<folder>/<id>-<filename>` key
 * via `StorageAdapter.put` + `StorageAdapter.delete`.
 *
 * Note on streaming: the `StorageAdapter` contract is byte-buffer
 * shaped, not stream-shaped. TUS chunks under 50 MB fit in memory by
 * design. For very large uploads, projects can swap in the official
 * `@tus/file-store` (local-only) or the `@tus/s3-store` adapters
 * directly — those bypass this wrapper.
 */

import { Readable } from "node:stream";

import { DataStore, Upload } from "@tus/utils";

import type { StorageAdapter } from "./storage-adapter.js";

const TUS_PREFIX = "_tus/";
const META_SUFFIX = ".meta";

interface UploadMetadata {
  size: number | null;
  offset: number;
  metadata: Record<string, string | null> | null;
  creation_date: string;
}

export class StorageAdapterDataStore extends DataStore {
  constructor(private readonly storage: StorageAdapter) {
    super();
    this.extensions = ["creation", "creation-defer-length", "termination", "expiration"];
  }

  async create(file: Upload): Promise<Upload> {
    const meta: UploadMetadata = {
      size: file.size ?? null,
      offset: 0,
      metadata: file.metadata ?? null,
      creation_date: new Date().toISOString(),
    };
    await this.storage.put({
      key: this.metaKey(file.id),
      body: encodeJson(meta),
      mimeType: "application/json",
    });
    // Persist an empty body so resumable PATCHes always have a target
    // to append to. `signUrl` and `delete` still work against an empty
    // object.
    await this.storage.put({
      key: this.bodyKey(file.id),
      body: new Uint8Array(0),
      mimeType: file.metadata?.["filetype"] ?? "application/octet-stream",
    });
    return file;
  }

  async write(stream: Readable, id: string, offset: number): Promise<number> {
    const existing = await this.storage.get(this.bodyKey(id));
    if (existing.byteLength !== offset) {
      throw new Error(`tus: offset mismatch (expected ${existing.byteLength}, got ${offset})`);
    }
    const incoming = await collectStream(stream);
    const merged = new Uint8Array(existing.byteLength + incoming.byteLength);
    merged.set(existing, 0);
    merged.set(incoming, existing.byteLength);

    const meta = await this.readMeta(id);
    const mimeType = meta.metadata?.["filetype"] ?? "application/octet-stream";
    await this.storage.put({ key: this.bodyKey(id), body: merged, mimeType });

    const newOffset = merged.byteLength;
    meta.offset = newOffset;
    await this.writeMeta(id, meta);
    return newOffset;
  }

  async getUpload(id: string): Promise<Upload> {
    const meta = await this.readMeta(id);
    return new Upload({
      id,
      offset: meta.offset,
      ...(meta.size !== null ? { size: meta.size } : {}),
      ...(meta.metadata ? { metadata: meta.metadata } : {}),
      ...(meta.creation_date ? { creation_date: meta.creation_date } : {}),
    });
  }

  async declareUploadLength(id: string, uploadLength: number): Promise<void> {
    const meta = await this.readMeta(id);
    meta.size = uploadLength;
    await this.writeMeta(id, meta);
  }

  async remove(id: string): Promise<void> {
    await Promise.all([
      this.storage.delete(this.bodyKey(id)),
      this.storage.delete(this.metaKey(id)),
    ]);
  }

  override async deleteExpired(): Promise<number> {
    const expirationSeconds = this.getExpiration();
    if (!expirationSeconds || expirationSeconds <= 0) return 0;
    const cutoff = Date.now() - expirationSeconds * 1000;
    const metaKeys = (await this.storage.list(TUS_PREFIX)).filter((k) =>
      k.endsWith(META_SUFFIX),
    );
    let purged = 0;
    for (const metaKey of metaKeys) {
      const id = metaKey.slice(TUS_PREFIX.length, -META_SUFFIX.length);
      try {
        const meta = await this.readMeta(id);
        const created = Date.parse(meta.creation_date);
        if (Number.isFinite(created) && created < cutoff) {
          await this.remove(id);
          purged += 1;
        }
      } catch {
        // Ignore corrupted meta — it'll be picked up by the next sweep.
        continue;
      }
    }
    return purged;
  }

  // ── helpers ──

  private metaKey(id: string): string {
    return `${TUS_PREFIX}${id}${META_SUFFIX}`;
  }

  private bodyKey(id: string): string {
    return `${TUS_PREFIX}${id}`;
  }

  /**
   * Read + decode the upload's metadata blob. Public so the
   * upload-complete hook can read the metadata without re-implementing
   * the encoding.
   */
  async readMeta(id: string): Promise<UploadMetadata> {
    const bytes = await this.storage.get(this.metaKey(id));
    return JSON.parse(new TextDecoder().decode(bytes)) as UploadMetadata;
  }

  private async writeMeta(id: string, meta: UploadMetadata): Promise<void> {
    await this.storage.put({
      key: this.metaKey(id),
      body: encodeJson(meta),
      mimeType: "application/json",
    });
  }

  /**
   * Read the assembled bytes of a completed upload. Used by the
   * `POST_FINISH` hook to copy them to the final key.
   */
  async readBody(id: string): Promise<Uint8Array> {
    return this.storage.get(this.bodyKey(id));
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

async function collectStream(stream: Readable): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const slice =
      chunk instanceof Uint8Array
        ? chunk
        : typeof chunk === "string"
          ? new TextEncoder().encode(chunk)
          : new Uint8Array(chunk as ArrayBuffer);
    chunks.push(slice);
    total += slice.byteLength;
  }
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const c of chunks) {
    merged.set(c, cursor);
    cursor += c.byteLength;
  }
  return merged;
}
