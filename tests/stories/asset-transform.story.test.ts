import { describe, expect, it } from "vitest";

import { InMemoryStorageAdapter } from "../../src/core/files/storage-adapter.js";
import {
  AssetService,
  type AssetTransformer,
  type TransformOptions,
  computeCacheKey,
} from "../../src/core/files/asset.service.js";

/**
 * Story · Asset-Endpoint with transformations + cache (PLAN.md §8 + §32 Phase 4).
 *
 * The service:
 *   1. fetches the original from storage
 *   2. computes a deterministic cache key from (key, options)
 *   3. returns the cached transform if present
 *   4. otherwise runs the transformer (`sharp` in production), stores
 *      the result under the cache key, and returns it
 *
 * The transformer interface is injectable so tests don't pull in
 * `sharp`; the production binding wraps the real library.
 */
describe("Story · Asset transformations + cache", () => {
  function setup(): {
    origin: InMemoryStorageAdapter;
    cache: InMemoryStorageAdapter;
    transformer: AssetTransformer & { calls: number };
    service: AssetService;
  } {
    const origin = new InMemoryStorageAdapter();
    const cache = new InMemoryStorageAdapter();
    let calls = 0;
    const transformer: AssetTransformer & { calls: number } = {
      get calls() {
        return calls;
      },
      async transform(bytes, options): Promise<{ bytes: Uint8Array; mimeType: string }> {
        calls += 1;
        const tag = `[${options.width ?? 0}x${options.height ?? 0}-${options.format ?? "orig"}]`;
        const out = new TextEncoder().encode(`${tag}${new TextDecoder().decode(bytes)}`);
        const mime = options.format === "webp" ? "image/webp" : "image/png";
        return { bytes: out, mimeType: mime };
      },
    };
    return {
      origin,
      cache,
      transformer,
      service: new AssetService({ origin, cache, transformer }),
    };
  }

  function asBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  describe("computeCacheKey()", () => {
    it("returns a stable hash that depends on key + options", () => {
      const a = computeCacheKey("avatar.png", { width: 200, height: 200 });
      const b = computeCacheKey("avatar.png", { width: 200, height: 200 });
      const c = computeCacheKey("avatar.png", { width: 300, height: 300 });
      const d = computeCacheKey("other.png", { width: 200, height: 200 });
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a).not.toBe(d);
    });

    it("option-key order does not change the cache key", () => {
      const a = computeCacheKey("k", { width: 10, height: 20, format: "webp" });
      const b = computeCacheKey("k", { format: "webp", height: 20, width: 10 });
      expect(a).toBe(b);
    });

    it("starts with the `assets/` prefix so cache entries are namespaced", () => {
      expect(computeCacheKey("k", { width: 10 }).startsWith("assets/")).toBe(true);
    });
  });

  describe("AssetService.deliver()", () => {
    it("fetches origin, transforms, caches, returns bytes + mimeType", async () => {
      const { origin, cache, transformer, service } = setup();
      await origin.put({ key: "avatar.png", body: asBytes("original"), mimeType: "image/png" });

      const opts: TransformOptions = { width: 200, height: 200, format: "webp" };
      const result = await service.deliver("avatar.png", opts);

      expect(result.mimeType).toBe("image/webp");
      expect(new TextDecoder().decode(result.bytes)).toBe("[200x200-webp]original");
      expect(transformer.calls).toBe(1);
      const cacheKey = computeCacheKey("avatar.png", opts);
      expect(await cache.exists(cacheKey)).toBe(true);
    });

    it("hits the cache on the second call (no transformer invocation)", async () => {
      const { origin, transformer, service } = setup();
      await origin.put({ key: "k", body: asBytes("orig"), mimeType: "image/png" });
      await service.deliver("k", { width: 100 });
      await service.deliver("k", { width: 100 });
      expect(transformer.calls).toBe(1);
    });

    it("different options produce different cache entries", async () => {
      const { origin, transformer, service } = setup();
      await origin.put({ key: "k", body: asBytes("orig"), mimeType: "image/png" });
      await service.deliver("k", { width: 100 });
      await service.deliver("k", { width: 200 });
      expect(transformer.calls).toBe(2);
    });

    it("throws when the original key is missing", async () => {
      const { service } = setup();
      await expect(service.deliver("missing", { width: 1 })).rejects.toThrow();
    });

    it("passes through (no transform) when options are empty", async () => {
      const { origin, transformer, service } = setup();
      await origin.put({ key: "k", body: asBytes("untouched"), mimeType: "image/png" });
      const result = await service.deliver("k", {});
      expect(new TextDecoder().decode(result.bytes)).toBe("untouched");
      expect(transformer.calls).toBe(0);
    });
  });
});
