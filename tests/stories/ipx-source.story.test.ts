import { describe, expect, it } from "vitest";

import { storageAdapterSource } from "../../src/core/files/ipx-source.js";
import { InMemoryStorageAdapter } from "../../src/core/files/storage-adapter.js";

/**
 * Story · IPX storage-adapter source.
 *
 * Brücke between IPX's `IPXStorage` interface (`getMeta`, `getData`)
 * and our `StorageAdapter.get(key)`. IPX strips a leading `/` from
 * incoming ids, but our `StorageAdapter` keys never start with `/` —
 * the source normalises both to align.
 *
 * `getData` returns `undefined` for missing keys (IPX uses that to
 * emit a 404 with `IPX_RESOURCE_NOT_FOUND`).
 */
describe("Story · IPX storageAdapterSource", () => {
  function setupAdapter(): InMemoryStorageAdapter {
    const adapter = new InMemoryStorageAdapter();
    return adapter;
  }

  it("returns the raw bytes of a stored object via `getData`", async () => {
    const adapter = setupAdapter();
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await adapter.put({ key: "files/abc", body: bytes, mimeType: "image/png" });
    const source = storageAdapterSource(adapter);
    const data = await source.getData("files/abc");
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(data!)).toEqual(bytes);
  });

  it("normalises a leading slash in the IPX id to the bare storage key", async () => {
    const adapter = setupAdapter();
    const bytes = new Uint8Array([7, 8, 9]);
    await adapter.put({ key: "files/abc", body: bytes, mimeType: "image/png" });
    const source = storageAdapterSource(adapter);
    const data = await source.getData("/files/abc");
    expect(data).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(data!)).toEqual(bytes);
  });

  it("returns undefined when the key is missing (IPX uses this for its 404 path)", async () => {
    const adapter = setupAdapter();
    const source = storageAdapterSource(adapter);
    const data = await source.getData("files/missing");
    expect(data).toBeUndefined();
    const meta = await source.getMeta("files/missing");
    expect(meta).toBeUndefined();
  });

  it("returns metadata with a default `maxAge` for cache headers", async () => {
    const adapter = setupAdapter();
    await adapter.put({ key: "k", body: new Uint8Array([1]), mimeType: "image/png" });
    const source = storageAdapterSource(adapter);
    const meta = await source.getMeta("k");
    expect(meta).toBeDefined();
    expect(typeof meta!.maxAge).toBe("number");
  });

  it("exposes a stable name", () => {
    const source = storageAdapterSource(setupAdapter());
    expect(source.name).toBe("storage-adapter");
  });
});
