import { describe, expect, it } from "vitest";

import {
  AssetService,
  type AssetTransformer,
  computeCacheKey,
  computeOptionsHash,
} from "../../src/core/files/asset.service.js";
import { InMemoryStorageAdapter } from "../../src/core/files/storage-adapter.js";
import { InMemoryVariantCacheIndex } from "../../src/core/files/variant-cache-index.js";

/**
 * Story · `AssetService.invalidateSource` cascades through the
 * variant index (CF.STORAGE.01 closure — iter-183).
 *
 * The deviation register's last open CF.STORAGE.01 line item: the
 * AssetService's per-cache-key storage cannot enumerate "all
 * variants for source X" so cascade-invalidation on origin
 * re-upload had to walk the entire `assets/*` prefix. Iter-183
 * adds the optional `variantIndex` constructor binding + the
 * `invalidateSource` cascade. This story pins both behaviors:
 *
 *   1. Cache-miss path records the variant in the index when bound.
 *   2. `invalidateSource(sourceKey)` enumerates via the index, drops
 *      the bytes from the storage adapter, and removes the index
 *      rows; idempotent on subsequent calls; isolated from siblings.
 *   3. Without a `variantIndex` binding the AssetService behaves
 *      identically to pre-iter-183 (no behavior change for projects
 *      that skip the migration).
 */
describe("Story · AssetService cascade invalidation via VariantCacheIndex (iter-183)", () => {
  const fakeTransformer: AssetTransformer = {
    async transform(bytes, options) {
      return {
        bytes: new Uint8Array([...bytes, options.width ?? 0, options.height ?? 0]),
        mimeType: `image/${options.format ?? "jpeg"}`,
      };
    },
  };

  function build(): {
    origin: InMemoryStorageAdapter;
    cache: InMemoryStorageAdapter;
    index: InMemoryVariantCacheIndex;
    service: AssetService;
  } {
    const origin = new InMemoryStorageAdapter();
    const cache = new InMemoryStorageAdapter();
    const index = new InMemoryVariantCacheIndex();
    const service = new AssetService({
      origin,
      cache,
      transformer: fakeTransformer,
      variantIndex: index,
    });
    return { origin, cache, index, service };
  }

  it("cache-miss records the variant in the index with sourceKey + optionsHash + sizeBytes + mimeType", async () => {
    const { origin, index, service } = build();
    await origin.put({ key: "src/a.png", body: new Uint8Array([1, 2, 3]), mimeType: "image/png" });

    const result = await service.deliver("src/a.png", { width: 100, format: "webp" });
    expect(result.mimeType).toBe("image/webp");

    const variants = await index.listBySourceKey("src/a.png");
    expect(variants).toHaveLength(1);
    expect(variants[0]?.cacheKey).toBe(
      computeCacheKey("src/a.png", { width: 100, format: "webp" }),
    );
    expect(variants[0]?.optionsHash).toBe(computeOptionsHash({ width: 100, format: "webp" }));
    expect(variants[0]?.mimeType).toBe("image/webp");
    expect(variants[0]?.sizeBytes).toBe(result.bytes.byteLength);
  });

  it("cache HIT does not re-record the variant (idempotent on lookup)", async () => {
    const { origin, index, service } = build();
    await origin.put({ key: "src/a.png", body: new Uint8Array([1]), mimeType: "image/png" });

    await service.deliver("src/a.png", { width: 100, format: "webp" });
    const beforeStats = await index.getStats();
    expect(beforeStats.entryCount).toBe(1);

    // Second call with same options — cache HIT, no fresh transform,
    // no re-record (the index row from the first miss is sufficient).
    await service.deliver("src/a.png", { width: 100, format: "webp" });
    const afterStats = await index.getStats();
    expect(afterStats.entryCount).toBe(1);
  });

  it("multiple transform variants for the same source land as separate index rows", async () => {
    const { origin, index, service } = build();
    await origin.put({ key: "src/a.png", body: new Uint8Array([1]), mimeType: "image/png" });

    await origin.put({ key: "src/b.png", body: new Uint8Array([9]), mimeType: "image/png" });
    await service.deliver("src/a.png", { width: 100, format: "webp" });
    await service.deliver("src/a.png", { width: 200, format: "webp" });
    await service.deliver("src/a.png", { width: 100, format: "avif" });
    await service.deliver("src/b.png", { width: 100, format: "webp" });

    const aVariants = await index.listBySourceKey("src/a.png");
    expect(aVariants).toHaveLength(3);
    const aHashes = new Set(aVariants.map((v) => v.optionsHash));
    expect(aHashes.size).toBe(3);
  });

  it("invalidateSource cascades through the index, drops bytes from cache, and returns the dropped count", async () => {
    const { origin, cache, index, service } = build();
    await origin.put({ key: "src/a.png", body: new Uint8Array([1]), mimeType: "image/png" });

    await service.deliver("src/a.png", { width: 100, format: "webp" });
    await service.deliver("src/a.png", { width: 200, format: "webp" });
    const ck1 = computeCacheKey("src/a.png", { width: 100, format: "webp" });
    const ck2 = computeCacheKey("src/a.png", { width: 200, format: "webp" });
    expect(await cache.exists(ck1)).toBe(true);
    expect(await cache.exists(ck2)).toBe(true);

    const dropped = await service.invalidateSource("src/a.png");
    expect(dropped).toBe(2);
    expect(await cache.exists(ck1)).toBe(false);
    expect(await cache.exists(ck2)).toBe(false);
    expect(await index.listBySourceKey("src/a.png")).toEqual([]);
  });

  it("invalidateSource is idempotent on a second call (count is 0, no error)", async () => {
    const { origin, service } = build();
    await origin.put({ key: "src/a.png", body: new Uint8Array([1]), mimeType: "image/png" });
    await service.deliver("src/a.png", { width: 100, format: "webp" });

    expect(await service.invalidateSource("src/a.png")).toBe(1);
    expect(await service.invalidateSource("src/a.png")).toBe(0);
  });

  it("invalidateSource leaves sibling sources untouched", async () => {
    const { origin, cache, index, service } = build();
    await origin.put({ key: "src/a.png", body: new Uint8Array([1]), mimeType: "image/png" });
    await origin.put({ key: "src/b.png", body: new Uint8Array([2]), mimeType: "image/png" });
    await service.deliver("src/a.png", { width: 100, format: "webp" });
    await service.deliver("src/b.png", { width: 100, format: "webp" });

    expect(await service.invalidateSource("src/a.png")).toBe(1);
    expect(await index.listBySourceKey("src/b.png")).toHaveLength(1);
    const ckB = computeCacheKey("src/b.png", { width: 100, format: "webp" });
    expect(await cache.exists(ckB)).toBe(true);
  });

  it("when no variantIndex is bound, AssetService.invalidateSource returns 0 (no behavior change for projects that skip the migration)", async () => {
    const origin = new InMemoryStorageAdapter();
    const cache = new InMemoryStorageAdapter();
    const service = new AssetService({ origin, cache, transformer: fakeTransformer });
    // No variantIndex passed.
    await origin.put({ key: "src/a.png", body: new Uint8Array([1]), mimeType: "image/png" });
    await service.deliver("src/a.png", { width: 100, format: "webp" });

    // Without the index, the cascade can't enumerate — returns 0.
    // The cache row STAYS until manual eviction via the legacy path.
    const dropped = await service.invalidateSource("src/a.png");
    expect(dropped).toBe(0);
    const ck = computeCacheKey("src/a.png", { width: 100, format: "webp" });
    expect(await cache.exists(ck)).toBe(true);
  });

  it("invalidateSource swallows storage delete errors so a partial cascade still removes the index row", async () => {
    const { origin, index, service } = build();
    await origin.put({ key: "src/a.png", body: new Uint8Array([1]), mimeType: "image/png" });
    await service.deliver("src/a.png", { width: 100, format: "webp" });

    // Replace the cache adapter with one that throws on delete to
    // simulate a storage-level race (TTL evicted the bytes between
    // findMany and delete).
    const failingCache = {
      ...((service as unknown as { _cache: object })._cache as object),
      async delete() {
        throw new Error("simulated storage outage");
      },
      async exists() {
        return false;
      },
    };
    Object.assign((service as unknown as { _cache: object })._cache, failingCache);

    const dropped = await service.invalidateSource("src/a.png");
    // The cascade still reports 1 — the index row WAS dropped, the
    // storage delete just failed (already-evicted etc.). Index
    // contract is the source of truth for the cascade count.
    expect(dropped).toBe(1);
    expect(await index.listBySourceKey("src/a.png")).toEqual([]);
  });

  it("computeOptionsHash is stable for sorted-key-equivalent options objects", () => {
    const a = computeOptionsHash({ width: 100, height: 200, format: "webp" });
    const b = computeOptionsHash({ format: "webp", height: 200, width: 100 });
    expect(a).toBe(b);
  });

  it("computeOptionsHash differs across distinct option sets (collision-safe under the 16-char prefix)", () => {
    const a = computeOptionsHash({ width: 100, format: "webp" });
    const b = computeOptionsHash({ width: 200, format: "webp" });
    expect(a).not.toBe(b);
  });
});
