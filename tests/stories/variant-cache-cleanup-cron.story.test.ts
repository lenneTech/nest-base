import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  InMemoryVariantCacheIndex,
  type VariantCacheEntry,
} from "../../src/core/files/variant-cache-index.js";
import {
  VariantCacheCleanupCron,
  VARIANT_CACHE_CLEANUP_INTERVAL_MS,
  DEFAULT_VARIANT_CACHE_RETENTION_DAYS,
} from "../../src/core/files/variant-cache-cleanup.js";

/**
 * Story · `VariantCacheCleanupCron` (CF.STORAGE.01 follow-up — iter-184).
 *
 * Iter-183 added the discoverable variant index. Iter-184's e2e
 * proved the cross-restart contract. The reviewer flagged a remaining
 * unbounded-growth risk: every cache miss writes a row, rows are
 * dropped only on explicit `removeBySourceKey` cascade — under
 * sustained traffic the index grows monotonically while the matching
 * cache bytes may already be storage-evicted (orphan rows).
 *
 * This slice mirrors `IdempotencyCleanupCron` + `GeocodingCacheCleanupCron`:
 * a 24h cron that calls `deleteOlderThan(cutoffMs)` on the bound index
 * with a default 90-day retention window. Adapters that don't expose
 * `deleteOlderThan` (legacy seam) fall back to log-only via
 * duck-typing — same contract as the sibling crons.
 */
describe("Story · VariantCacheCleanupCron prunes orphan variant rows (iter-184)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 4, 6, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
      createdAt: new Date(),
      ...overrides,
    };
  }

  it("DEFAULT_VARIANT_CACHE_RETENTION_DAYS matches the sibling cleanup-cron retention window (90d)", () => {
    expect(DEFAULT_VARIANT_CACHE_RETENTION_DAYS).toBe(90);
  });

  it("VARIANT_CACHE_CLEANUP_INTERVAL_MS matches the sibling cron tick (24h)", () => {
    expect(VARIANT_CACHE_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("InMemoryVariantCacheIndex.deleteOlderThan removes entries with createdAt < cutoff", async () => {
    const index = new InMemoryVariantCacheIndex();
    const now = Date.now();
    await index.record(
      entry("ck1", "img/a", { createdAt: new Date(now - 100 * 24 * 60 * 60 * 1000) }), // 100d ago
    );
    await index.record(
      entry("ck2", "img/a", { createdAt: new Date(now - 91 * 24 * 60 * 60 * 1000) }), // 91d ago
    );
    await index.record(
      entry("ck3", "img/a", { createdAt: new Date(now - 30 * 24 * 60 * 60 * 1000) }), // 30d ago — fresh
    );

    const cutoffMs = now - 90 * 24 * 60 * 60 * 1000;
    const deleted = await index.deleteOlderThan(cutoffMs);
    expect(deleted).toBe(2);

    const survivors = await index.listBySourceKey("img/a");
    expect(survivors).toHaveLength(1);
    expect(survivors[0]?.cacheKey).toBe("ck3");
  });

  it("InMemoryVariantCacheIndex.deleteOlderThan returns 0 when nothing matches", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(entry("ck1", "img/a", { createdAt: new Date(Date.now() - 1_000) }));
    expect(await index.deleteOlderThan(Date.now() - 60_000)).toBe(0);
  });

  it("runOnce() returns { cutoffMs, deleted } and prunes via the bound index", async () => {
    const index = new InMemoryVariantCacheIndex();
    const now = Date.now();
    await index.record(
      entry("ck1", "img/a", { createdAt: new Date(now - 100 * 24 * 60 * 60 * 1000) }),
    );
    await index.record(entry("ck2", "img/a", { createdAt: new Date(now - 1_000) }));

    const cron = new VariantCacheCleanupCron(index);
    const result = await cron.runOnce();
    expect(result.cutoffMs).toBe(now - 90 * 24 * 60 * 60 * 1000);
    expect(result.deleted).toBe(1);
  });

  it("runOnce() is idempotent — second call deletes 0 because the first call pruned", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(
      entry("old", "img/a", { createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000) }),
    );

    const cron = new VariantCacheCleanupCron(index);
    expect((await cron.runOnce()).deleted).toBe(1);
    expect((await cron.runOnce()).deleted).toBe(0);
  });

  it("runOnce() returns { deleted: null } for legacy adapters without deleteOlderThan (duck-typing fallback)", async () => {
    const legacyIndex = {
      async record() {},
      async listBySourceKey() {
        return [];
      },
      async removeByCacheKey() {
        return false;
      },
      async removeBySourceKey() {
        return [] as string[];
      },
      async getStats() {
        return { entryCount: 0, totalBytes: 0 };
      },
    };
    const cron = new VariantCacheCleanupCron(legacyIndex);
    const result = await cron.runOnce();
    expect(result.deleted).toBeNull();
    expect(typeof result.cutoffMs).toBe("number");
  });

  it("onModuleInit schedules a 24h interval; onModuleDestroy clears it (no leaked timers)", async () => {
    const index = new InMemoryVariantCacheIndex();
    const cron = new VariantCacheCleanupCron(index);
    cron.onModuleInit();
    expect(vi.getTimerCount()).toBe(1);
    cron.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("onModuleInit fires runOnce immediately so a cold-boot prunes any stale rows from the prior process", async () => {
    const index = new InMemoryVariantCacheIndex();
    await index.record(
      entry("from-prior", "img/a", {
        createdAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      }),
    );
    const cron = new VariantCacheCleanupCron(index);
    cron.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(await index.listBySourceKey("img/a")).toEqual([]);
    cron.onModuleDestroy();
  });

  it("the cron isolates per-tick errors — a thrown deleteOlderThan still leaves the interval scheduled", async () => {
    const erroringIndex = {
      async record() {},
      async listBySourceKey() {
        return [];
      },
      async removeByCacheKey() {
        return false;
      },
      async removeBySourceKey() {
        return [] as string[];
      },
      async getStats() {
        return { entryCount: 0, totalBytes: 0 };
      },
      async deleteOlderThan() {
        throw new Error("simulated DB outage");
      },
    };
    const cron = new VariantCacheCleanupCron(erroringIndex);
    const result = await cron.runOnce();
    expect(result.deleted).toBeNull();
  });
});
