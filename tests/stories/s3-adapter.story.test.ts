import { describe, expect, it } from 'vitest';

import {
  S3StorageAdapter,
  type S3Operations,
} from '../../src/core/files/s3-storage-adapter.js';
import { StorageObjectNotFoundError } from '../../src/core/files/storage-adapter.js';

/**
 * Story · S3 Storage Adapter (PLAN.md §8 + §32 Phase 4).
 *
 * Implements the StorageAdapter contract against any S3-API-compatible
 * backend (RustFS, AWS S3, Cloudflare R2, Backblaze B2, …). Uses an
 * injectable `S3Operations` so tests stay AWS-SDK-free; the real
 * `AwsS3Operations` (next slice / wiring) wraps `@aws-sdk/client-s3`
 * + `@aws-sdk/s3-request-presigner`.
 */
describe('Story · S3 Storage Adapter', () => {
  function makeOps(): S3Operations & { calls: { method: string; key: string; meta?: unknown }[] } {
    const calls: { method: string; key: string; meta?: unknown }[] = [];
    const objects = new Map<string, { body: Uint8Array; mimeType: string }>();
    return {
      get calls() {
        return calls;
      },
      async putObject(key, body, mimeType) {
        calls.push({ method: 'putObject', key, meta: { mimeType, size: body.byteLength } });
        objects.set(key, { body, mimeType });
      },
      async getObject(key) {
        calls.push({ method: 'getObject', key });
        const v = objects.get(key);
        if (!v) return null;
        return { body: v.body, mimeType: v.mimeType };
      },
      async deleteObject(key) {
        calls.push({ method: 'deleteObject', key });
        return objects.delete(key);
      },
      async headObject(key) {
        calls.push({ method: 'headObject', key });
        return objects.has(key);
      },
      async listObjects(prefix) {
        calls.push({ method: 'listObjects', key: prefix });
        const keys: string[] = [];
        for (const k of objects.keys()) {
          if (k.startsWith(prefix)) keys.push(k);
        }
        return keys.sort();
      },
      async presignGet(key, ttlSeconds) {
        calls.push({ method: 'presignGet', key, meta: { ttlSeconds } });
        return `https://rustfs.example/${encodeURIComponent(key)}?expires=${ttlSeconds}`;
      },
    };
  }

  function asBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  it('put() forwards to S3Operations.putObject and returns metadata', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    const result = await adapter.put({ key: 't/avatar.png', body: asBytes('hello'), mimeType: 'image/png' });
    expect(result).toEqual({ key: 't/avatar.png', sizeBytes: 5, mimeType: 'image/png' });
    expect(ops.calls).toContainEqual({ method: 'putObject', key: 't/avatar.png', meta: { mimeType: 'image/png', size: 5 } });
  });

  it('get() returns the bytes from S3Operations.getObject', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    await adapter.put({ key: 'k', body: asBytes('hello'), mimeType: 'text/plain' });
    const bytes = await adapter.get('k');
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('get() throws StorageObjectNotFoundError when S3Operations returns null', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    await expect(adapter.get('missing')).rejects.toThrow(StorageObjectNotFoundError);
  });

  it('delete() returns the boolean from S3Operations', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    await adapter.put({ key: 'k', body: asBytes('x'), mimeType: 't/p' });
    expect(await adapter.delete('k')).toBe(true);
    expect(await adapter.delete('k')).toBe(false);
  });

  it('exists() reflects S3Operations.headObject', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    expect(await adapter.exists('k')).toBe(false);
    await adapter.put({ key: 'k', body: asBytes('x'), mimeType: 't/p' });
    expect(await adapter.exists('k')).toBe(true);
  });

  it('signUrl() forwards to S3Operations.presignGet', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    await adapter.put({ key: 'avatar.png', body: asBytes('p'), mimeType: 'image/png' });
    const url = await adapter.signUrl('avatar.png', 600);
    expect(url).toContain('avatar.png');
    expect(url).toMatch(/expires=600/);
  });

  it('signUrl() rejects non-positive ttl without calling S3Operations', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    await expect(adapter.signUrl('k', 0)).rejects.toThrow();
    expect(ops.calls.find((c) => c.method === 'presignGet')).toBeUndefined();
  });

  it('signUrl() throws StorageObjectNotFoundError when the object does not exist', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    await expect(adapter.signUrl('missing', 60)).rejects.toThrow(StorageObjectNotFoundError);
  });

  it('list() returns sorted keys matching the prefix', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    await adapter.put({ key: 't/c.txt', body: asBytes('x'), mimeType: 't/p' });
    await adapter.put({ key: 't/a.txt', body: asBytes('x'), mimeType: 't/p' });
    await adapter.put({ key: 'other/b.txt', body: asBytes('x'), mimeType: 't/p' });
    expect(await adapter.list('t/')).toEqual(['t/a.txt', 't/c.txt']);
  });

  it('put() rejects an empty key without touching S3', async () => {
    const ops = makeOps();
    const adapter = new S3StorageAdapter(ops);
    await expect(
      adapter.put({ key: '', body: asBytes('h'), mimeType: 'text/plain' }),
    ).rejects.toThrow(/key/);
    expect(ops.calls.find((c) => c.method === 'putObject')).toBeUndefined();
  });
});
