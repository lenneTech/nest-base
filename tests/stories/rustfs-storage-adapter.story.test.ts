import { describe, expect, it } from "vitest";

/**
 * Story · RustFS-native storage adapter (CF.FILES.05).
 *
 * The PRD's `CF.FILES.05` requires a RustFS-native adapter alongside
 * the S3 / Local FS / Postgres LO adapters. RustFS is S3-API-
 * compatible, but the "native" contract carries RustFS-flavoured
 * defaults that differ from generic S3 setups:
 *
 *   - Force path-style addressing (RustFS doesn't support
 *     virtual-host style URLs by default).
 *   - Default endpoint resolution from `RUSTFS_ENDPOINT` /
 *     `STORAGE_RUSTFS_ENDPOINT` instead of inferring from a region.
 *   - Lower default presigned-URL TTL since RustFS deployments are
 *     typically same-network (no need for the 1h S3-default).
 *
 * The adapter delegates to the same `S3Operations` interface used by
 * `S3StorageAdapter` — RustFS speaks S3 — but applies the defaults
 * above when constructed via the convenience constructor.
 */
describe("Story · RustFS-native storage adapter", () => {
  const operations = () => {
    const store = new Map<string, { body: Uint8Array; mimeType: string }>();
    return {
      putObject: async (key: string, body: Uint8Array, mimeType: string) => {
        store.set(key, { body, mimeType });
      },
      getObject: async (key: string) => {
        const obj = store.get(key);
        return obj ? { body: obj.body, mimeType: obj.mimeType } : null;
      },
      deleteObject: async (key: string) => {
        return store.delete(key);
      },
      headObject: async (key: string) => {
        return store.has(key);
      },
      listObjects: async (prefix: string) => {
        return [...store.keys()].filter((k) => k.startsWith(prefix));
      },
      presignGet: async (key: string, ttlSeconds: number) => {
        return `https://rustfs.local/${key}?ttl=${ttlSeconds}`;
      },
    };
  };

  it("implements the StorageAdapter contract (put/get/delete/exists/list)", async () => {
    const { RustFsStorageAdapter } = await import("../../src/core/files/rustfs-storage-adapter.js");
    const adapter = new RustFsStorageAdapter(operations());
    const meta = await adapter.put({
      key: "tenant1/file1.txt",
      body: new TextEncoder().encode("hello rustfs"),
      mimeType: "text/plain",
    });
    expect(meta.key).toBe("tenant1/file1.txt");
    expect(meta.sizeBytes).toBe(12);
    expect(meta.mimeType).toBe("text/plain");

    const fetched = await adapter.get("tenant1/file1.txt");
    expect(new TextDecoder().decode(fetched)).toBe("hello rustfs");

    expect(await adapter.exists("tenant1/file1.txt")).toBe(true);
    expect(await adapter.list("tenant1/")).toEqual(["tenant1/file1.txt"]);

    expect(await adapter.delete("tenant1/file1.txt")).toBe(true);
    expect(await adapter.exists("tenant1/file1.txt")).toBe(false);
  });

  it("throws StorageObjectNotFoundError on get of missing key", async () => {
    const { RustFsStorageAdapter } = await import("../../src/core/files/rustfs-storage-adapter.js");
    const { StorageObjectNotFoundError } = await import("../../src/core/files/storage-adapter.js");
    const adapter = new RustFsStorageAdapter(operations());
    await expect(adapter.get("nonexistent")).rejects.toBeInstanceOf(StorageObjectNotFoundError);
  });

  it("rejects signUrl TTL above RustFS default ceiling", async () => {
    const { RustFsStorageAdapter } = await import("../../src/core/files/rustfs-storage-adapter.js");
    const adapter = new RustFsStorageAdapter(operations());
    // The TTL cap check fires before the object-existence check, so it
    // applies even for non-existent keys. RustFS default is 600s; 7200s
    // (2h) exceeds the cap.
    await expect(adapter.signUrl("file.txt", 7200)).rejects.toThrow(/exceeds cap/i);
    // Within-cap requests against an existing object are honoured.
    await adapter.put({
      key: "file.txt",
      body: new TextEncoder().encode("x"),
      mimeType: "text/plain",
    });
    const shortUrl = await adapter.signUrl("file.txt", 60);
    expect(shortUrl).toContain("ttl=60");
  });

  it("RUSTFS_DEFAULT_MAX_TTL_SECONDS is 600s (10 min)", async () => {
    const { RUSTFS_DEFAULT_MAX_TTL_SECONDS } =
      await import("../../src/core/files/rustfs-storage-adapter.js");
    expect(RUSTFS_DEFAULT_MAX_TTL_SECONDS).toBe(600);
  });

  it("custom maxTtlSeconds overrides the RustFS default", async () => {
    const { RustFsStorageAdapter } = await import("../../src/core/files/rustfs-storage-adapter.js");
    const adapter = new RustFsStorageAdapter(operations(), { maxTtlSeconds: 30 });
    await adapter.put({
      key: "file.txt",
      body: new TextEncoder().encode("x"),
      mimeType: "text/plain",
    });
    // Within-cap → honoured verbatim.
    const url = await adapter.signUrl("file.txt", 30);
    expect(url).toContain("ttl=30");
    // Above-cap → rejected (cap check fires before object-existence check).
    await expect(adapter.signUrl("file.txt", 60)).rejects.toThrow(/exceeds cap/i);
  });
});
