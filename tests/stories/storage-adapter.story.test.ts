import { describe, expect, it } from "vitest";

import {
  InMemoryStorageAdapter,
  StorageObjectNotFoundError,
  type StorageAdapter,
  type StoragePutInput,
} from "../../src/core/files/storage-adapter.js";

/**
 * Story · Storage-Adapter-Interface.
 *
 * Contract:
 *   - `put(input)`     → stores bytes under `key`, returns metadata
 *   - `get(key)`       → returns the bytes; throws on miss
 *   - `delete(key)`    → returns true if removed, false if missing
 *   - `exists(key)`    → boolean
 *   - `signUrl(key, ttlSeconds)` → time-bounded URL (adapter-specific shape)
 *   - `list(prefix)`   → matching keys, lexicographically sorted
 *
 * The InMemoryStorageAdapter is the reference implementation that
 * tests + dev tooling consume; the S3 / Local / Postgres adapters
 * follow in subsequent slices and are tested through this contract.
 */
describe("Story · Storage-Adapter contract", () => {
  function freshAdapter(): InMemoryStorageAdapter {
    return new InMemoryStorageAdapter();
  }

  function asBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  describe("put() / get() / exists()", () => {
    it("put() stores bytes and returns metadata containing key + size", async () => {
      const adapter: StorageAdapter = freshAdapter();
      const result = await adapter.put({
        key: "tenant/abc/avatar.png",
        body: asBytes("hello"),
        mimeType: "image/png",
      });
      expect(result.key).toBe("tenant/abc/avatar.png");
      expect(result.sizeBytes).toBe(5);
      expect(result.mimeType).toBe("image/png");
    });

    it("get() returns the previously stored bytes", async () => {
      const adapter = freshAdapter();
      await adapter.put({ key: "k", body: asBytes("hello"), mimeType: "text/plain" });
      const bytes = await adapter.get("k");
      expect(new TextDecoder().decode(bytes)).toBe("hello");
    });

    it("get() throws StorageObjectNotFoundError for an unknown key", async () => {
      const adapter = freshAdapter();
      await expect(adapter.get("missing")).rejects.toThrow(StorageObjectNotFoundError);
    });

    it("exists() reflects insertion + deletion", async () => {
      const adapter = freshAdapter();
      expect(await adapter.exists("k")).toBe(false);
      await adapter.put({ key: "k", body: asBytes("h"), mimeType: "text/plain" });
      expect(await adapter.exists("k")).toBe(true);
      await adapter.delete("k");
      expect(await adapter.exists("k")).toBe(false);
    });
  });

  describe("delete()", () => {
    it("returns true when the object existed", async () => {
      const adapter = freshAdapter();
      await adapter.put({ key: "k", body: asBytes("h"), mimeType: "t/p" });
      expect(await adapter.delete("k")).toBe(true);
    });

    it("returns false when the object was already missing", async () => {
      const adapter = freshAdapter();
      expect(await adapter.delete("missing")).toBe(false);
    });
  });

  describe("signUrl()", () => {
    it("returns a URL that includes the key + expiry", async () => {
      const adapter = freshAdapter();
      await adapter.put({ key: "avatar.png", body: asBytes("p"), mimeType: "image/png" });
      const url = await adapter.signUrl("avatar.png", 600);
      expect(url).toContain("avatar.png");
      expect(url).toMatch(/[?&]expires=\d+/);
    });

    it("rejects a non-positive ttl", async () => {
      const adapter = freshAdapter();
      await adapter.put({ key: "k", body: asBytes("h"), mimeType: "text/plain" });
      await expect(adapter.signUrl("k", 0)).rejects.toThrow();
    });

    it("throws StorageObjectNotFoundError on a missing key", async () => {
      const adapter = freshAdapter();
      await expect(adapter.signUrl("missing", 60)).rejects.toThrow(StorageObjectNotFoundError);
    });
  });

  describe("list()", () => {
    it("returns matching keys sorted ascending", async () => {
      const adapter = freshAdapter();
      const keys = ["tenant/a.txt", "tenant/c.txt", "tenant/b.txt"];
      for (const key of keys) {
        await adapter.put({ key, body: asBytes("x"), mimeType: "t/p" });
      }
      const result = await adapter.list("tenant/");
      expect(result).toEqual(["tenant/a.txt", "tenant/b.txt", "tenant/c.txt"]);
    });

    it("skips entries that do not match the prefix", async () => {
      const adapter = freshAdapter();
      await adapter.put({ key: "a/1", body: asBytes("x"), mimeType: "t/p" });
      await adapter.put({ key: "b/1", body: asBytes("x"), mimeType: "t/p" });
      expect(await adapter.list("a/")).toEqual(["a/1"]);
    });

    it("returns [] when nothing matches", async () => {
      const adapter = freshAdapter();
      expect(await adapter.list("nothing/")).toEqual([]);
    });
  });

  describe("input validation", () => {
    it("put() rejects empty key", async () => {
      const adapter = freshAdapter();
      const input: StoragePutInput = { key: "", body: asBytes("h"), mimeType: "text/plain" };
      await expect(adapter.put(input)).rejects.toThrow(/key/);
    });
  });
});
