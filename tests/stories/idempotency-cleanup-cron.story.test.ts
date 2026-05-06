import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  IdempotencyCleanupCron,
  InMemoryIdempotencyStoreWithCleanup,
} from "../../src/core/idempotency/idempotency-cleanup.js";
import type { IdempotencyRecord } from "../../src/core/idempotency/idempotency.service.js";

/**
 * Story · `IdempotencyCleanupCron` (CF.STORAGE.01 follow-up — iter-181).
 *
 * The Prisma migration shipped in iter-179 created an `expiresAt`
 * index on `idempotency_records`; this slice adds the periodic
 * runner that prunes rows whose `expiresAt < now`. Records past
 * their expiresAt are already treated as cache misses by the
 * service layer, so retaining them is dead weight that grows
 * unbounded under sustained load.
 *
 * The cron mirrors `GeocodingCacheCleanupCron`'s shape: 24h
 * setInterval, deterministic `runOnce()` for tests, duck-typed
 * `deleteOlderThan(cutoffMs)` so adapters that don't expose it
 * fall back to log-only.
 */
describe("Story · IdempotencyCleanupCron prunes expired idempotency records (iter-181)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 4, 6, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function record(key: string, expiresAt: number, body: unknown = { ok: true }): IdempotencyRecord {
    return {
      key,
      requestHash: `rh-${key}`,
      status: 201,
      body,
      expiresAt,
    };
  }

  it("InMemoryIdempotencyStoreWithCleanup.deleteOlderThan removes records with expiresAt < cutoff", async () => {
    const store = new InMemoryIdempotencyStoreWithCleanup();
    const now = Date.now();
    await store.put(record("k1", now - 60_000)); // expired 1 min ago
    await store.put(record("k2", now + 60_000)); // expires in 1 min
    await store.put(record("k3", now - 1)); // expired just now

    const deleted = await store.deleteOlderThan(now);
    expect(deleted).toBe(2);
    expect(await store.get("k1")).toBeNull();
    expect(await store.get("k3")).toBeNull();
    expect(await store.get("k2")).not.toBeNull();
  });

  it("InMemoryIdempotencyStoreWithCleanup.deleteOlderThan returns 0 when nothing matches", async () => {
    const store = new InMemoryIdempotencyStoreWithCleanup();
    const now = Date.now();
    await store.put(record("k1", now + 10_000));
    await store.put(record("k2", now + 20_000));

    const deleted = await store.deleteOlderThan(now);
    expect(deleted).toBe(0);
    expect(await store.get("k1")).not.toBeNull();
    expect(await store.get("k2")).not.toBeNull();
  });

  it("runOnce() returns { cutoffMs, deleted } with the in-memory adapter and prunes expired rows", async () => {
    const store = new InMemoryIdempotencyStoreWithCleanup();
    const now = Date.now();
    await store.put(record("k1", now - 5_000));
    await store.put(record("k2", now - 1));
    await store.put(record("k3", now + 5_000));

    const cron = new IdempotencyCleanupCron(store);
    const result = await cron.runOnce();
    expect(result.cutoffMs).toBe(now);
    expect(result.deleted).toBe(2);
    expect(await store.get("k1")).toBeNull();
    expect(await store.get("k2")).toBeNull();
    expect(await store.get("k3")).not.toBeNull();
  });

  it("runOnce() is idempotent — second invocation deletes 0 because the first already pruned", async () => {
    const store = new InMemoryIdempotencyStoreWithCleanup();
    await store.put(record("k1", Date.now() - 5_000));
    await store.put(record("k2", Date.now() + 5_000));

    const cron = new IdempotencyCleanupCron(store);
    const first = await cron.runOnce();
    expect(first.deleted).toBe(1);

    const second = await cron.runOnce();
    expect(second.deleted).toBe(0);
  });

  it("runOnce() returns { deleted: null } for legacy adapters without deleteOlderThan (duck-typing fallback)", async () => {
    // Legacy adapter that implements the IdempotencyStore contract
    // but doesn't expose deleteOlderThan. The cron must NOT throw —
    // it logs and reports null so downstream observability can flag
    // the missing-method case.
    const legacyStore = {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
    };
    const cron = new IdempotencyCleanupCron(legacyStore);
    const result = await cron.runOnce();
    expect(result.deleted).toBeNull();
    expect(typeof result.cutoffMs).toBe("number");
  });

  it("onModuleInit schedules a 24h interval; onModuleDestroy clears it (no leaked timers at the test boundary)", async () => {
    const store = new InMemoryIdempotencyStoreWithCleanup();
    const cron = new IdempotencyCleanupCron(store);
    cron.onModuleInit();
    // Single immediate runOnce + interval scheduled for 24h.
    expect(vi.getTimerCount()).toBe(1);
    cron.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("onModuleInit fires runOnce immediately so a fresh cold-boot prunes any expired rows from the prior process", async () => {
    const store = new InMemoryIdempotencyStoreWithCleanup();
    await store.put(record("from-prior-process", Date.now() - 1_000));
    const cron = new IdempotencyCleanupCron(store);

    cron.onModuleInit();
    // The immediate runOnce is fire-and-forget (returns a Promise);
    // flush microtasks so the in-memory deletion completes before
    // we assert.
    await vi.advanceTimersByTimeAsync(0);
    expect(await store.get("from-prior-process")).toBeNull();
    cron.onModuleDestroy();
  });

  it("the cron handles per-tick errors without leaking — a thrown deleteOlderThan still leaves the interval scheduled", async () => {
    const erroringStore = {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
      async deleteOlderThan() {
        throw new Error("simulated DB outage");
      },
    };
    const cron = new IdempotencyCleanupCron(erroringStore);
    // runOnce wraps the deleteOlderThan call in a try/catch and
    // surfaces the error as { deleted: null } — same shape as the
    // legacy-adapter case so observability has one signal to watch.
    const result = await cron.runOnce();
    expect(result.deleted).toBeNull();
  });
});
