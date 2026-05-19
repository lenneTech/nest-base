import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VERIFICATION_RETENTION_DAYS,
  InMemoryVerificationStore,
  VERIFICATION_CLEANUP_INTERVAL_MS,
  VerificationCleanupCron,
  type VerificationStore,
} from "../../src/core/auth/verification-cleanup.js";

/**
 * Story · `VerificationCleanupCron` (iter-193).
 *
 * Better-Auth's `Verification` table accumulates one row per
 * email-verify / password-reset / magic-link issuance. Better-Auth
 * itself does NOT prune the table — under sustained signup/reset
 * traffic the table grows unbounded with stale tokens. The cron
 * mirrors `IdempotencyCleanupCron` + `GeocodingCacheCleanupCron` +
 * `VariantCacheCleanupCron`: every 24h, prune rows whose
 * `expiresAt < now - 7d` (keeps recently-expired tokens for short-
 * term operator debugging, drops anything older than a week).
 *
 * Adapters that don't expose `deleteOlderThan` (legacy seam) fall
 * back to log-only via duck-typing — same shape as the sibling
 * crons. Per-tick errors are caught + reported as `{deleted: null}`
 * so a transient DB outage does not crash-loop the process.
 */
describe("Story · VerificationCleanupCron prunes stale Better-Auth verification rows (iter-193)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 4, 6, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("DEFAULT_VERIFICATION_RETENTION_DAYS = 7 (one-week post-expiry retention window)", () => {
    expect(DEFAULT_VERIFICATION_RETENTION_DAYS).toBe(7);
  });

  it("VERIFICATION_CLEANUP_INTERVAL_MS = 24h (parity with sibling crons)", () => {
    expect(VERIFICATION_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("InMemoryVerificationStore.deleteOlderThan removes rows with expiresAt < cutoff", async () => {
    const store = new InMemoryVerificationStore();
    const now = Date.now();
    await store.put({ id: "old", identifier: "a@x", expiresAt: now - 100 * 24 * 60 * 60 * 1000 });
    await store.put({ id: "fresh", identifier: "a@x", expiresAt: now + 60 * 60 * 1000 });
    await store.put({ id: "borderline", identifier: "b@x", expiresAt: now - 5 });

    const deleted = await store.deleteOlderThan(now);
    expect(deleted).toBe(2);
    expect(await store.size()).toBe(1);
  });

  it("runOnce() returns {cutoffMs, deleted} with cutoff = now - 7d (default retention)", async () => {
    const store = new InMemoryVerificationStore();
    const now = Date.now();
    await store.put({
      id: "ancient",
      identifier: "x@y",
      expiresAt: now - 30 * 24 * 60 * 60 * 1000,
    });
    await store.put({
      id: "fresh",
      identifier: "x@y",
      expiresAt: now + 1 * 24 * 60 * 60 * 1000,
    });

    const cron = new VerificationCleanupCron(store);
    const result = await cron.runOnce();
    expect(result.cutoffMs).toBe(now - 7 * 24 * 60 * 60 * 1000);
    expect(result.deleted).toBe(1);
  });

  it("runOnce() returns 0 when every row is still inside the retention window", async () => {
    const store = new InMemoryVerificationStore();
    const now = Date.now();
    // Expired rows but younger than the 7-day retention window.
    await store.put({ id: "v1", identifier: "x@y", expiresAt: now - 1 * 24 * 60 * 60 * 1000 });
    await store.put({ id: "v2", identifier: "x@y", expiresAt: now - 3 * 24 * 60 * 60 * 1000 });

    const cron = new VerificationCleanupCron(store);
    const result = await cron.runOnce();
    expect(result.deleted).toBe(0);
    expect(await store.size()).toBe(2);
  });

  it("runOnce() is idempotent — second tick deletes 0 because the first already pruned", async () => {
    const store = new InMemoryVerificationStore();
    await store.put({
      id: "stale",
      identifier: "x@y",
      expiresAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    });

    const cron = new VerificationCleanupCron(store);
    expect((await cron.runOnce()).deleted).toBe(1);
    expect((await cron.runOnce()).deleted).toBe(0);
  });

  it("runOnce() returns {deleted: null} for legacy adapters without deleteOlderThan (duck-typing fallback)", async () => {
    const legacyStore: VerificationStore = {
      async put() {},
      async size() {
        return 0;
      },
    };
    const cron = new VerificationCleanupCron(legacyStore);
    const result = await cron.runOnce();
    expect(result.deleted).toBeNull();
    expect(typeof result.cutoffMs).toBe("number");
  });

  it("runOnce() catches per-tick errors and reports {deleted: null} so transient DB outages do not crash-loop", async () => {
    const erroringStore = {
      async put() {},
      async size() {
        return 0;
      },
      async deleteOlderThan() {
        throw new Error("simulated DB outage");
      },
    };
    const cron = new VerificationCleanupCron(erroringStore);
    const result = await cron.runOnce();
    expect(result.deleted).toBeNull();
  });

  it("onModuleInit schedules a 24h interval; onModuleDestroy clears it (no leaked timers)", async () => {
    const store = new InMemoryVerificationStore();
    const cron = new VerificationCleanupCron(store);
    await cron.onModuleInit();
    expect(vi.getTimerCount()).toBe(1);
    cron.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("onModuleInit fires runOnce immediately so a fresh cold-boot prunes any stale rows from the prior process", async () => {
    const store = new InMemoryVerificationStore();
    await store.put({
      id: "from-prior",
      identifier: "x@y",
      expiresAt: Date.now() - 100 * 24 * 60 * 60 * 1000,
    });
    const cron = new VerificationCleanupCron(store);
    await cron.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    expect(await store.size()).toBe(0);
    cron.onModuleDestroy();
  });
});
