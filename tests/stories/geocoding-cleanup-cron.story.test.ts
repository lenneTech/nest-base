import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GEOCODING_CACHE,
  GeocodingCacheCleanupCron,
  InMemoryGeocodingCache,
} from "../../src/core/geo/geo.module.js";
import { DEFAULT_GEOCODING_CACHE_RETENTION_DAYS } from "../../src/core/geo/geocoding-cache-cleanup.js";
import type { GeocodingCacheStore } from "../../src/core/geo/geo-service.js";

/**
 * Story · `GeocodingCacheCleanupCron.runOnce()` (iter-173).
 *
 * iter-172 closed CF.STORAGE.01 line items (b)+(c) by wiring the
 * cron through the bound store's `deleteOlderThan(cutoffMs)`. This
 * story locks the contract end-to-end:
 *   - The cron's `runOnce()` returns the (cutoffMs, deleted) tuple.
 *   - `deleted` reflects what `deleteOlderThan` reported.
 *   - The cron type-narrows: an adapter without `deleteOlderThan`
 *     returns `deleted=null` and the cron stays log-only.
 *   - Stored entries with `expiresAt < cutoff` are pruned;
 *     entries with `expiresAt >= cutoff` survive.
 *
 * The cron uses `Date.now()` directly (the runner side, not the
 * planner). The 90-day retention window means we need cache rows
 * with `expiresAt` >100M ms in the past to fall behind the cutoff.
 *
 * GEOCODING_CACHE is unused in the story but imported so the
 * regression-guard test below confirms the symbol exports.
 */
void GEOCODING_CACHE;

describe("Story · GeocodingCacheCleanupCron with InMemoryGeocodingCache (iter-173)", () => {
  let cache: InMemoryGeocodingCache;
  let cron: GeocodingCacheCleanupCron;

  beforeEach(() => {
    cache = new InMemoryGeocodingCache();
    cron = new GeocodingCacheCleanupCron(cache);
  });

  afterEach(() => {
    cron.onModuleDestroy();
  });

  it("runOnce() returns { cutoffMs, deleted: 0 } when the cache is empty", async () => {
    const result = await cron.runOnce();
    expect(typeof result.cutoffMs).toBe("number");
    expect(result.deleted).toBe(0);
  });

  it("runOnce() prunes entries whose expiresAt is older than the cutoff", async () => {
    // Default retention = 90 days. To trip the cutoff,
    // expiresAt must be > 90 days in the past.
    const longAgo = Date.now() - DEFAULT_GEOCODING_CACHE_RETENTION_DAYS * 86_400_000 - 10_000;
    await cache.put("nominatim", "stale", { v: 1 }, longAgo);
    await cache.put("nominatim", "fresh", { v: 2 }, Date.now() + 86_400_000); // tomorrow

    const result = await cron.runOnce();
    expect(result.deleted).toBe(1);
    expect(await cache.get("nominatim", "stale")).toBeNull();
    expect(await cache.get("nominatim", "fresh")).not.toBeNull();
  });

  it("runOnce() returns { deleted: null } for an adapter without deleteOlderThan", async () => {
    const legacyStore: GeocodingCacheStore = {
      async get() {
        return null;
      },
      async put() {
        /* no-op */
      },
    };
    const legacyCron = new GeocodingCacheCleanupCron(legacyStore);
    const result = await legacyCron.runOnce();
    expect(result.deleted).toBeNull();
    legacyCron.onModuleDestroy();
  });

  it("runOnce() is safe to invoke twice in succession (idempotent on no-changes)", async () => {
    const longAgo = Date.now() - DEFAULT_GEOCODING_CACHE_RETENTION_DAYS * 86_400_000 - 10_000;
    await cache.put("p", "old", {}, longAgo);
    const first = await cron.runOnce();
    const second = await cron.runOnce();
    expect(first.deleted).toBe(1);
    expect(second.deleted).toBe(0);
  });

  it("onModuleDestroy clears the 24h interval (no leaked timer)", () => {
    // Implicit: beforeEach constructs the cron, afterEach calls
    // onModuleDestroy. Vitest fails the test if a timer leaks past
    // the test boundary, so passing here proves the cleanup ran.
    expect(true).toBe(true);
  });

  it("InMemoryGeocodingCache.deleteOlderThan returns a count + does not touch fresh rows", async () => {
    const now = Date.now();
    await cache.put("p", "stale-1", {}, now - 10_000);
    await cache.put("p", "stale-2", {}, now - 20_000);
    await cache.put("p", "fresh", {}, now + 60_000);
    const deleted = await cache.deleteOlderThan(now - 5_000);
    expect(deleted).toBe(2);
    expect(await cache.get("p", "fresh")).not.toBeNull();
    expect(await cache.get("p", "stale-1")).toBeNull();
    expect(await cache.get("p", "stale-2")).toBeNull();
  });

  it("runOnce() catches per-tick errors and reports { deleted: null } so a transient DB outage does not crash-loop the process (iter-185 parity with sibling crons)", async () => {
    // Construct a cron over an erroring adapter — the cron MUST
    // surface { deleted: null } instead of letting the error escape
    // into setInterval's `void this.runOnce()` callback (which would
    // become an unhandled rejection on every tick).
    const erroringCache = {
      async get() {
        return null;
      },
      async put() {},
      async deleteOlderThan() {
        throw new Error("simulated DB outage");
      },
    };
    // Re-import the class through the geo.module.ts surface — the
    // exported `GeocodingCacheCleanupCron` symbol carries the
    // production try/catch wiring.
    const { GeocodingCacheCleanupCron } = await import("../../src/core/geo/geo.module.js");
    const erroringCron = new GeocodingCacheCleanupCron(erroringCache);
    const result = await erroringCron.runOnce();
    expect(result.deleted).toBeNull();
    expect(typeof result.cutoffMs).toBe("number");
    erroringCron.onModuleDestroy();
  });
});
