import { Readable } from "node:stream";

import { Upload } from "@tus/utils";
import { describe, expect, it } from "vitest";

import { StorageAdapterDataStore } from "../../src/core/files/storage-adapter-data-store.js";
import { InMemoryStorageAdapter } from "../../src/core/files/storage-adapter.js";

/**
 * Story · TUS DataStore wrapping a StorageAdapter.
 *
 * Forwards `create / write / getUpload / declareUploadLength / remove`
 * onto a StorageAdapter so resumable uploads persist into the same
 * backend that finished files do.
 */
describe("Story · StorageAdapterDataStore", () => {
  it("create() persists an upload record with offset=0", async () => {
    const storage = new InMemoryStorageAdapter();
    const store = new StorageAdapterDataStore(storage);
    const upload = new Upload({ id: "u1", size: 11, offset: 0, metadata: { filetype: "t/p" } });
    await store.create(upload);
    const got = await store.getUpload("u1");
    expect(got.offset).toBe(0);
    expect(got.size).toBe(11);
    expect(got.metadata).toEqual({ filetype: "t/p" });
  });

  it("write() appends bytes and bumps the offset", async () => {
    const storage = new InMemoryStorageAdapter();
    const store = new StorageAdapterDataStore(storage);
    await store.create(new Upload({ id: "u1", size: 11, offset: 0 }));
    const after1 = await store.write(Readable.from([Buffer.from("hello")]), "u1", 0);
    expect(after1).toBe(5);
    const after2 = await store.write(Readable.from([Buffer.from(" world")]), "u1", 5);
    expect(after2).toBe(11);
    const body = await store.readBody("u1");
    expect(new TextDecoder().decode(body)).toBe("hello world");
  });

  it("write() rejects an offset mismatch", async () => {
    const storage = new InMemoryStorageAdapter();
    const store = new StorageAdapterDataStore(storage);
    await store.create(new Upload({ id: "u1", size: 5, offset: 0 }));
    await store.write(Readable.from([Buffer.from("hi")]), "u1", 0);
    await expect(
      store.write(Readable.from([Buffer.from("x")]), "u1", 0),
    ).rejects.toThrow(/offset/i);
  });

  it("declareUploadLength() updates the persisted size", async () => {
    const storage = new InMemoryStorageAdapter();
    const store = new StorageAdapterDataStore(storage);
    await store.create(new Upload({ id: "u1", offset: 0 }));
    await store.declareUploadLength("u1", 100);
    expect((await store.getUpload("u1")).size).toBe(100);
  });

  it("remove() drops both the body and the meta blob", async () => {
    const storage = new InMemoryStorageAdapter();
    const store = new StorageAdapterDataStore(storage);
    await store.create(new Upload({ id: "u1", size: 1, offset: 0 }));
    await store.remove("u1");
    expect(await storage.exists("_tus/u1")).toBe(false);
    expect(await storage.exists("_tus/u1.meta")).toBe(false);
  });
});
