/**
 * Prisma binding for `FileBlobOperations`.
 *
 * Production wrapper around `prisma.fileBlob.*` so the
 * `PostgresStorageAdapter` stays DB-agnostic. Each instance is bound
 * to a single `tenantId` and forwards every operation through the
 * RLS-aware Prisma transaction client.
 *
 * Why per-tenant: the `FileBlob` table is scoped by `(tenantId, key)`
 * and the project's RLS policies require the tenant id to be set on
 * every connection. Constructing the operations object once per
 * request (with the resolved tenant id) keeps the adapter pure and
 * lets the controller bridge to the auth layer cleanly.
 */

import type { FileBlobOperations, FileBlobRow } from "./postgres-storage-adapter.js";

interface FileBlobRowFromDb {
  tenantId: string;
  key: string;
  mimeType: string;
  body: Uint8Array | Buffer;
  sizeBytes: number;
}

interface FileBlobTable {
  upsert(input: {
    where: { tenantId_key: { tenantId: string; key: string } };
    create: {
      tenantId: string;
      key: string;
      body: Uint8Array;
      mimeType: string;
      sizeBytes: number;
    };
    update: { body: Uint8Array; mimeType: string; sizeBytes: number };
  }): Promise<FileBlobRowFromDb>;
  findUnique(input: {
    where: { tenantId_key: { tenantId: string; key: string } };
  }): Promise<FileBlobRowFromDb | null>;
  delete(input: {
    where: { tenantId_key: { tenantId: string; key: string } };
  }): Promise<FileBlobRowFromDb>;
  findMany(input: {
    where: { tenantId: string; key: { startsWith: string } };
  }): Promise<FileBlobRowFromDb[]>;
}

export interface PrismaFileBlobDeps {
  tenantId: string;
  fileBlob: FileBlobTable;
}

export class PrismaFileBlobOperations implements FileBlobOperations {
  constructor(private readonly deps: PrismaFileBlobDeps) {}

  async upsert(key: string, body: Uint8Array, mimeType: string): Promise<void> {
    await this.deps.fileBlob.upsert({
      where: { tenantId_key: { tenantId: this.deps.tenantId, key } },
      create: {
        tenantId: this.deps.tenantId,
        key,
        body,
        mimeType,
        sizeBytes: body.byteLength,
      },
      update: { body, mimeType, sizeBytes: body.byteLength },
    });
  }

  async findByKey(key: string): Promise<FileBlobRow | null> {
    const row = await this.deps.fileBlob.findUnique({
      where: { tenantId_key: { tenantId: this.deps.tenantId, key } },
    });
    if (!row) return null;
    return { mimeType: row.mimeType, body: toUint8Array(row.body) };
  }

  async deleteByKey(key: string): Promise<boolean> {
    try {
      await this.deps.fileBlob.delete({
        where: { tenantId_key: { tenantId: this.deps.tenantId, key } },
      });
      return true;
    } catch (err) {
      // Prisma's `P2025` = record-to-delete-not-found. Map to `false`
      // so the caller can treat the operation idempotently.
      const code = (err as { code?: string }).code;
      if (code === "P2025") return false;
      throw err;
    }
  }

  async existsByKey(key: string): Promise<boolean> {
    const row = await this.deps.fileBlob.findUnique({
      where: { tenantId_key: { tenantId: this.deps.tenantId, key } },
    });
    return row !== null;
  }

  async listKeys(prefix: string): Promise<string[]> {
    const rows = await this.deps.fileBlob.findMany({
      where: { tenantId: this.deps.tenantId, key: { startsWith: prefix } },
    });
    return rows.map((r) => r.key).sort();
  }
}

function toUint8Array(input: Uint8Array | Buffer): Uint8Array {
  if (input instanceof Uint8Array) return input;
  // Buffer is a subclass of Uint8Array in Node — but the type guard
  // above only narrows when running against the Prisma client (which
  // returns plain `Uint8Array`); the runtime cast keeps tests passing
  // when fakes return `Buffer` explicitly.
  return new Uint8Array(input);
}
