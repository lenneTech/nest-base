/**
 * Story · TUS onUploadFinish exposes File id + storage key via headers (issue #102).
 *
 * After all bytes of a TUS upload are received the server promotes the
 * chunk into the FileService (creates a FileRecord) and attaches two
 * custom response headers to the final 204 PATCH response so clients
 * don't need a follow-up request:
 *
 *   Upload-File-Id:      <FileRecord.id>
 *   Upload-Storage-Key:  <FileRecord.storageKey>
 *
 * This story drives the pure `buildTusFinishHook` planner — a thin
 * factory that returns an `onUploadFinish` function wired to a
 * `FileService`. No `@tus/server` import needed; the hook contract
 * (`(upload) => Promise<{ headers }>`) is declared locally so the test
 * stays fast.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { InMemoryStorageAdapter } from "../../src/core/files/storage-adapter.js";
import { StorageAdapterDataStore } from "../../src/core/files/storage-adapter-data-store.js";
import { buildTusFinishHook } from "../../src/core/files/tus-finish-hook.js";
import {
  FileService,
  type FileServiceStorage,
  type FileRecord,
} from "../../src/core/files/file.service.js";
// Import the files module to register the FileService.withStorageAdapter static method.
import "../../src/core/files/files.module.js";

/**
 * Minimal in-memory FileServiceStorage for test isolation.
 */
function makeFileStorage(): FileServiceStorage & { records: Map<string, FileRecord> } {
  const records = new Map<string, FileRecord>();
  return {
    get records() {
      return records;
    },
    async insert(record) {
      records.set(record.id, record);
      return record;
    },
    async findById(id) {
      return records.get(id) ?? null;
    },
    async findByIdInTenant(_tenantId, id) {
      return records.get(id) ?? null;
    },
    async listByFolder(tenantId, folderId) {
      return [...records.values()].filter(
        (r) => r.tenantId === tenantId && r.folderId === folderId,
      );
    },
    async update(id, patch) {
      const existing = records.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      records.set(id, updated);
      return updated;
    },
    async delete(id) {
      return records.delete(id);
    },
  };
}

describe("Story · TUS onUploadFinish headers (issue #102)", () => {
  it("returns Upload-File-Id and Upload-Storage-Key headers after a completed upload", async () => {
    const storage = new InMemoryStorageAdapter();
    const dataStore = new StorageAdapterDataStore(storage);
    const fileStorage = makeFileStorage();
    const fileService = FileService.withStorageAdapter(fileStorage, storage);

    const hook = buildTusFinishHook({ fileService, dataStore });

    // Simulate a completed TUS upload: write bytes into the data store
    // directly (mimicking what @tus/server does on PATCH).
    const { Upload } = await import("@tus/utils");
    const upload = new Upload({
      id: "test-upload-id",
      size: 5,
      offset: 5,
      metadata: {
        filename: "hello.txt",
        filetype: "text/plain",
        tenantId: "tenant-1",
        uploaderId: "user-1",
        folderId: null,
      },
    });
    // Seed the data store body directly so hook can read it.
    await dataStore.create(new Upload({ id: "test-upload-id", size: 5, offset: 0 }));
    const { Readable } = await import("node:stream");
    await dataStore.write(Readable.from([Buffer.from("hello")]), "test-upload-id", 0);

    // Pass null as the req parameter — the hook ignores it (issue #102).
    const result = await hook(null, upload);

    expect(result.headers).toBeDefined();
    expect(typeof result.headers!["Upload-File-Id"]).toBe("string");
    expect(typeof result.headers!["Upload-Storage-Key"]).toBe("string");
    // The file must have been promoted into FileService.
    const fileId = result.headers!["Upload-File-Id"] as string;
    const storageKey = result.headers!["Upload-Storage-Key"] as string;
    expect(fileStorage.records.size).toBe(1);
    const record = fileStorage.records.get(fileId);
    expect(record).toBeDefined();
    expect(record!.storageKey).toBe(storageKey);
    expect(record!.tenantId).toBe("tenant-1");
    expect(record!.uploaderId).toBe("user-1");
    expect(record!.filename).toBe("hello.txt");
    expect(record!.mimeType).toBe("text/plain");
    // Bytes must be at the final storage key.
    const bytes = await storage.get(storageKey);
    expect(new TextDecoder().decode(bytes)).toBe("hello");
    // sha256 sanity check.
    const expectedSha = createHash("sha256")
      .update(new TextEncoder().encode("hello"))
      .digest("hex");
    expect(record!.sha256).toBe(expectedSha);
  });

  it("uses 'application/octet-stream' when filetype metadata is absent", async () => {
    const storage = new InMemoryStorageAdapter();
    const dataStore = new StorageAdapterDataStore(storage);
    const fileStorage = makeFileStorage();
    const fileService = FileService.withStorageAdapter(fileStorage, storage);

    const hook = buildTusFinishHook({ fileService, dataStore });

    const { Upload } = await import("@tus/utils");
    await dataStore.create(new Upload({ id: "u2", size: 1, offset: 0 }));
    const { Readable } = await import("node:stream");
    await dataStore.write(Readable.from([Buffer.from("x")]), "u2", 0);

    const upload = new Upload({
      id: "u2",
      size: 1,
      offset: 1,
      metadata: {
        filename: "bin.dat",
        tenantId: "t1",
        uploaderId: "u1",
      },
    });

    const result = await hook(null, upload);
    const fileId = result.headers!["Upload-File-Id"] as string;
    const record = fileStorage.records.get(fileId)!;
    expect(record.mimeType).toBe("application/octet-stream");
  });

  it("cleans up the _tus/ entry after promoting the file", async () => {
    const storage = new InMemoryStorageAdapter();
    const dataStore = new StorageAdapterDataStore(storage);
    const fileStorage = makeFileStorage();
    const fileService = FileService.withStorageAdapter(fileStorage, storage);

    const hook = buildTusFinishHook({ fileService, dataStore });

    const { Upload } = await import("@tus/utils");
    await dataStore.create(new Upload({ id: "u3", size: 2, offset: 0 }));
    const { Readable } = await import("node:stream");
    await dataStore.write(Readable.from([Buffer.from("hi")]), "u3", 0);

    const upload = new Upload({
      id: "u3",
      size: 2,
      offset: 2,
      metadata: { filename: "x.bin", tenantId: "t1", uploaderId: "u1" },
    });

    await hook(null, upload);
    // Both _tus/<id> and _tus/<id>.meta should be gone.
    expect(await storage.exists("_tus/u3")).toBe(false);
    expect(await storage.exists("_tus/u3.meta")).toBe(false);
  });

  it("sets folderId to null when metadata.folderId is absent or null string", async () => {
    const storage = new InMemoryStorageAdapter();
    const dataStore = new StorageAdapterDataStore(storage);
    const fileStorage = makeFileStorage();
    const fileService = FileService.withStorageAdapter(fileStorage, storage);

    const hook = buildTusFinishHook({ fileService, dataStore });

    const { Upload } = await import("@tus/utils");
    await dataStore.create(new Upload({ id: "u4", size: 1, offset: 0 }));
    const { Readable } = await import("node:stream");
    await dataStore.write(Readable.from([Buffer.from("z")]), "u4", 0);

    const upload = new Upload({
      id: "u4",
      size: 1,
      offset: 1,
      // folderId intentionally absent from metadata
      metadata: { filename: "a.txt", tenantId: "t1", uploaderId: "u1" },
    });

    const result = await hook(null, upload);
    const fileId = result.headers!["Upload-File-Id"] as string;
    const record = fileStorage.records.get(fileId)!;
    expect(record.folderId).toBeNull();
  });
});
