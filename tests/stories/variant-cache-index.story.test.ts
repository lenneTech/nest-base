import { describe, expect, it } from "vitest";

import {
  InMemoryVariantCacheIndex,
  type VariantCacheEntry,
  type VariantCacheIndex,
} from "../../src/core/files/variant-cache-index.js";

/**
 * Story · `VariantCacheIndex` (CF.STORAGE.01 closure — iter-183).
 *
 * The deviation register's last open CF.STORAGE.01 line item:
 * `AssetService` content-addresses variants via `computeCacheKey
 * ({sourceKey, options})` but the cache STORAGE alone can't answer
 * "list every variant for source X" — invalidating a source on
 * re-upload requires walking the entire `assets/*` prefix on every
 * cascade. This index closes that gap with an explicit
 * `(cacheKey → sourceKey, optionsJson, mimeType, sizeBytes)` mapping
 * indexed on `sourceKey` so `removeBySourceKey` is O(log N).
 *
 * The interface ships with an in-memory adapter (this story) and a
 * Prisma-backed one (a separate story for the SQL binding). The
 * AssetService binding wires the index optionally so projects that
 * skip the migration keep the existing per-cache-key storage
 * semantics unchanged.
 */
describe("Story · VariantCacheIndex tracks variants per source for cascade invalidation (iter-183)", () => {
  function entry(
    cacheKey: string,
    sourceKey: string,
    overrides: Partial<VariantCacheEntry> = {},
  ): VariantCacheEntry {
    return {
      cacheKey,
      sourceKey,
      optionsHash: `oh-${cacheKey}`,
      mimeType: "image/webp",
      sizeBytes: 1024,
      createdAt: new Date("2026-05-06T10:00:00Z"),
      ...overrides,
    };
  }

  it("record + listBySourceKey round-trips a single entry", async () => {
    const index: VariantCacheIndex = new InMemoryVariantCacheIndex();
    await index.record(entry("ck1", "src/a.png"));

    const variants = await index.listBySourceKey("src/a.png");
    expect(variants).toHaveLength(1);
    expect(variants[0]?.cacheKey).toBe("ck1");
    expect(variants[0]?.sourceKey).toBe("src/a.png");
    expect(variants[0]?.mimeType).toBe("image/webp");
    expect(variants[0]?.sizeBytes).toBe(1024);
  });

  it("listBySourceKey returns multiple variants for the same source, isolated from other sources", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(entry("ck1", "src/a.png", { mimeType: "image/webp", sizeBytes: 200 }));
    await index.record(entry("ck2", "src/a.png", { mimeType: "image/avif", sizeBytes: 150 }));
    await index.record(entry("ck3", "src/b.png", { mimeType: "image/webp", sizeBytes: 500 }));

    const a = await index.listBySourceKey("src/a.png");
    expect(a.map((v) => v.cacheKey).sort()).toEqual(["ck1", "ck2"]);
    const b = await index.listBySourceKey("src/b.png");
    expect(b.map((v) => v.cacheKey)).toEqual(["ck3"]);
  });

  it("listBySourceKey returns an empty array for an unknown source", async () => {
    const index = new InMemoryVariantCacheIndex();
    expect(await index.listBySourceKey("missing")).toEqual([]);
  });

  it("record is idempotent on the same cacheKey — second insert replaces (refresh after re-transform)", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(entry("ck1", "src/a.png", { sizeBytes: 100 }));
    await index.record(entry("ck1", "src/a.png", { sizeBytes: 200 })); // re-transform produces fresh bytes

    const variants = await index.listBySourceKey("src/a.png");
    expect(variants).toHaveLength(1);
    expect(variants[0]?.sizeBytes).toBe(200);
  });

  it("removeByCacheKey deletes a single entry without affecting siblings", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(entry("ck1", "src/a.png"));
    await index.record(entry("ck2", "src/a.png"));

    const removed = await index.removeByCacheKey("ck1");
    expect(removed).toBe(true);
    const variants = await index.listBySourceKey("src/a.png");
    expect(variants).toHaveLength(1);
    expect(variants[0]?.cacheKey).toBe("ck2");
  });

  it("removeByCacheKey returns false for a missing key (best-effort cleanup)", async () => {
    const index = new InMemoryVariantCacheIndex();
    expect(await index.removeByCacheKey("missing")).toBe(false);
  });

  it("removeBySourceKey returns the cascade-deleted cacheKeys for the AssetService to drop from storage", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(entry("ck1", "src/a.png"));
    await index.record(entry("ck2", "src/a.png"));
    await index.record(entry("ck3", "src/b.png"));

    const cascaded = await index.removeBySourceKey("src/a.png");
    expect(cascaded.sort()).toEqual(["ck1", "ck2"]);
    expect(await index.listBySourceKey("src/a.png")).toEqual([]);
    expect(await index.listBySourceKey("src/b.png")).toHaveLength(1);
  });

  it("removeBySourceKey returns an empty array when no rows match (idempotent invalidation)", async () => {
    const index = new InMemoryVariantCacheIndex();
    expect(await index.removeBySourceKey("missing")).toEqual([]);
  });

  it("getStats returns total entry count + summed sizeBytes for observability", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(entry("ck1", "src/a.png", { sizeBytes: 100 }));
    await index.record(entry("ck2", "src/a.png", { sizeBytes: 200 }));
    await index.record(entry("ck3", "src/b.png", { sizeBytes: 500 }));

    const stats = await index.getStats();
    expect(stats.entryCount).toBe(3);
    expect(stats.totalBytes).toBe(800);
  });

  it("getStats returns zero counts on an empty index (boot-time safe)", async () => {
    const index = new InMemoryVariantCacheIndex();
    const stats = await index.getStats();
    expect(stats.entryCount).toBe(0);
    expect(stats.totalBytes).toBe(0);
  });

  it("optionsHash is preserved for variants that share a sourceKey but differ in transform", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(
      entry("ck-webp", "src/a.png", { optionsHash: "wh1", mimeType: "image/webp" }),
    );
    await index.record(
      entry("ck-avif", "src/a.png", { optionsHash: "ah1", mimeType: "image/avif" }),
    );

    const variants = await index.listBySourceKey("src/a.png");
    const hashes = variants.map((v) => v.optionsHash).sort();
    expect(hashes).toEqual(["ah1", "wh1"]);
  });
});
