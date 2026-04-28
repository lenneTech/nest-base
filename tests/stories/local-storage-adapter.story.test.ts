import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStorageAdapter } from '../../src/core/files/local-storage-adapter.js';
import { StorageObjectNotFoundError } from '../../src/core/files/storage-adapter.js';

/**
 * Story · Local Storage Adapter (PLAN.md §8 + §32 Phase 4).
 *
 * Implements the StorageAdapter contract against the local
 * filesystem. Used in dev (when RustFS is too heavy) and in tests
 * via a per-test temp directory.
 */
describe('Story · Local Storage Adapter', () => {
  let root: string;
  let adapter: LocalStorageAdapter;
  const baseUrl = 'http://localhost:3000/files';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'nst-local-storage-'));
    adapter = new LocalStorageAdapter({ root, baseUrl });
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function asBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  it('put() writes the file and returns metadata', async () => {
    const meta = await adapter.put({ key: 'tenant/avatar.png', body: asBytes('hello'), mimeType: 'image/png' });
    expect(meta).toEqual({ key: 'tenant/avatar.png', sizeBytes: 5, mimeType: 'image/png' });
  });

  it('get() returns the bytes round-trip', async () => {
    await adapter.put({ key: 'k', body: asBytes('hello'), mimeType: 'text/plain' });
    const bytes = await adapter.get('k');
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('get() throws StorageObjectNotFoundError for an unknown key', async () => {
    await expect(adapter.get('missing')).rejects.toThrow(StorageObjectNotFoundError);
  });

  it('exists() reflects insertion + deletion', async () => {
    expect(await adapter.exists('k')).toBe(false);
    await adapter.put({ key: 'k', body: asBytes('h'), mimeType: 'text/plain' });
    expect(await adapter.exists('k')).toBe(true);
    expect(await adapter.delete('k')).toBe(true);
    expect(await adapter.exists('k')).toBe(false);
  });

  it('delete() returns false on missing', async () => {
    expect(await adapter.delete('missing')).toBe(false);
  });

  it('signUrl() emits an absolute URL anchored to baseUrl', async () => {
    await adapter.put({ key: 'avatar.png', body: asBytes('p'), mimeType: 'image/png' });
    const url = await adapter.signUrl('avatar.png', 600);
    expect(url.startsWith(baseUrl)).toBe(true);
    expect(url).toContain('avatar.png');
    expect(url).toMatch(/expires=\d+/);
  });

  it('signUrl() rejects ttlSeconds <= 0', async () => {
    await expect(adapter.signUrl('k', 0)).rejects.toThrow();
  });

  it('signUrl() throws StorageObjectNotFoundError on a missing key', async () => {
    await expect(adapter.signUrl('missing', 60)).rejects.toThrow(StorageObjectNotFoundError);
  });

  it('list() returns sorted matching keys, excluding non-prefix entries', async () => {
    await adapter.put({ key: 't/c.txt', body: asBytes('x'), mimeType: 't/p' });
    await adapter.put({ key: 't/a.txt', body: asBytes('x'), mimeType: 't/p' });
    await adapter.put({ key: 'other/b.txt', body: asBytes('x'), mimeType: 't/p' });
    expect(await adapter.list('t/')).toEqual(['t/a.txt', 't/c.txt']);
  });

  it('rejects path-traversal keys (`../escape`) without writing anything', async () => {
    await expect(
      adapter.put({ key: '../escape.txt', body: asBytes('x'), mimeType: 't/p' }),
    ).rejects.toThrow(/path/i);
    expect(await adapter.exists('../escape.txt')).toBe(false);
  });

  it('rejects empty key on put()', async () => {
    await expect(adapter.put({ key: '', body: asBytes('h'), mimeType: 'text/plain' })).rejects.toThrow(/key/);
  });
});
