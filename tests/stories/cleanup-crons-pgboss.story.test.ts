/**
 * Story · Cleanup-cron pg-boss leader-election path (Finding 1 / issue #127).
 *
 * Four cleanup tasks — throttler, idempotency, verification, GeoIP —
 * each run a bare setInterval in a single-replica deployment. Under
 * multi-replica conditions every replica fires simultaneously, causing
 * unnecessary Postgres load. When `FEATURE_JOBS_PG_BOSS=true`, each
 * cron should register itself as a pg-boss scheduled job so only one
 * replica runs the cleanup at a time.
 *
 * This story tests:
 *   1. The pure planner `buildCleanupJobPlan` — input → { queueName, cron, singletonKey }.
 *   2. `ThrottlerCleanupCron` dual-mode: pg-boss path + setInterval fallback.
 *   3. `IdempotencyCleanupCron` dual-mode.
 *   4. `VerificationCleanupCron` dual-mode.
 *   5. `GeoIpRefreshCron` dual-mode (via geoip module).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCleanupJobPlan,
  type CleanupJobPlanInput,
} from "../../src/core/jobs/cleanup-job-planner.js";
import {
  IdempotencyCleanupCron,
  InMemoryIdempotencyStoreWithCleanup,
} from "../../src/core/idempotency/idempotency-cleanup.js";
import type { IdempotencyRecord } from "../../src/core/idempotency/idempotency.service.js";
import {
  InMemoryVerificationStore,
  VerificationCleanupCron,
} from "../../src/core/auth/verification-cleanup.js";
import { ThrottlerCleanupCron } from "../../src/core/throttler/throttler-cleanup.js";
import { GeoIpRefreshCron } from "../../src/core/geoip/geoip-refresh-cron.js";
import type { PgBossLike } from "../../src/core/jobs/scheduled-job-pgboss-scheduler.js";

// ---------------------------------------------------------------------------
// Fake helpers
// ---------------------------------------------------------------------------

function fakeBoss(): PgBossLike & {
  workCalls: Array<[string, () => Promise<unknown>]>;
  scheduleCalls: Array<[string, string]>;
} {
  const workCalls: Array<[string, () => Promise<unknown>]> = [];
  const scheduleCalls: Array<[string, string]> = [];
  return {
    workCalls,
    scheduleCalls,
    start: vi.fn(async () => undefined),
    work: vi.fn(async (name: string, handler: () => Promise<unknown>) => {
      workCalls.push([name, handler]);
    }),
    schedule: vi.fn(async (name: string, cron: string) => {
      scheduleCalls.push([name, cron]);
    }),
    stop: vi.fn(async () => undefined),
  };
}

function fakePrisma() {
  return {
    $executeRawUnsafe: vi.fn(async () => 0),
  };
}

function idempRecord(key: string, expiresAt: number): IdempotencyRecord {
  return { key, requestHash: `rh-${key}`, status: 200, body: {}, expiresAt };
}

// ---------------------------------------------------------------------------
// 1. Pure planner
// ---------------------------------------------------------------------------

describe("Story · buildCleanupJobPlan — pure planner (issue #127 Finding 1)", () => {
  it("returns queueName, cron, and singletonKey for a given cleanup kind", () => {
    const plan = buildCleanupJobPlan({ kind: "throttler" });
    expect(plan.queueName).toBeTypeOf("string");
    expect(plan.queueName.length).toBeGreaterThan(0);
    expect(plan.cron).toMatch(/^(\*|[0-9]+)(\s+(\*|[0-9]+)){4}$/);
    expect(plan.singletonKey).toBeTypeOf("string");
    expect(plan.singletonKey.length).toBeGreaterThan(0);
  });

  it("each cleanup kind gets a distinct queueName", () => {
    const kinds: CleanupJobPlanInput["kind"][] = [
      "throttler",
      "idempotency",
      "verification",
      "geoip",
    ];
    const names = kinds.map((kind) => buildCleanupJobPlan({ kind }).queueName);
    const unique = new Set(names);
    expect(unique.size).toBe(4);
  });

  it("throttler kind uses the documented hourly cron", () => {
    const plan = buildCleanupJobPlan({ kind: "throttler" });
    // Hourly: "0 * * * *"
    expect(plan.cron).toBe("0 * * * *");
  });

  it("idempotency kind uses the documented daily cron", () => {
    const plan = buildCleanupJobPlan({ kind: "idempotency" });
    // Daily at midnight: "0 0 * * *"
    expect(plan.cron).toBe("0 0 * * *");
  });

  it("verification kind uses the documented daily cron", () => {
    const plan = buildCleanupJobPlan({ kind: "verification" });
    expect(plan.cron).toBe("0 0 * * *");
  });

  it("geoip kind uses the documented daily cron", () => {
    const plan = buildCleanupJobPlan({ kind: "geoip" });
    expect(plan.cron).toBe("0 0 * * *");
  });

  it("singletonKey is stable across multiple calls (deterministic)", () => {
    const a = buildCleanupJobPlan({ kind: "idempotency" });
    const b = buildCleanupJobPlan({ kind: "idempotency" });
    expect(a.singletonKey).toBe(b.singletonKey);
  });
});

// ---------------------------------------------------------------------------
// 2. ThrottlerCleanupCron dual-mode
// ---------------------------------------------------------------------------

describe("Story · ThrottlerCleanupCron pg-boss dual-mode (issue #127 Finding 1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("registers work + schedule via pg-boss when a boss adapter is supplied", async () => {
    const boss = fakeBoss();
    const prisma = fakePrisma();
    const cron = new ThrottlerCleanupCron(prisma as never, boss);

    await cron.onModuleInit();

    expect(boss.workCalls.length).toBe(1);
    expect(boss.scheduleCalls.length).toBe(1);
    const [queueName] = boss.workCalls[0]!;
    expect(queueName).toBe(boss.scheduleCalls[0]?.[0]);
    // Timer must NOT be set — pg-boss path owns scheduling.
    expect(vi.getTimerCount()).toBe(0);

    await cron.onModuleDestroy();
  });

  it("falls back to setInterval when no boss is supplied", async () => {
    const prisma = fakePrisma();
    const cron = new ThrottlerCleanupCron(prisma as never);

    cron.onModuleInit();

    expect(vi.getTimerCount()).toBe(1);
    cron.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isPgBossActive() reflects which mode is active", async () => {
    const boss = fakeBoss();
    const cron = new ThrottlerCleanupCron(fakePrisma() as never, boss);
    expect(cron.isPgBossActive()).toBe(false);
    await cron.onModuleInit();
    expect(cron.isPgBossActive()).toBe(true);
    await cron.onModuleDestroy();
    expect(cron.isPgBossActive()).toBe(false);
  });

  it("falls back to setInterval when boss.work throws", async () => {
    const boss = fakeBoss();
    boss.work = vi.fn(async () => {
      throw new Error("pg-boss unavailable");
    });
    const cron = new ThrottlerCleanupCron(fakePrisma() as never, boss);
    cron.onModuleInit();
    await vi.advanceTimersByTimeAsync(0);
    // setInterval fallback should have been registered.
    expect(vi.getTimerCount()).toBe(1);
    cron.onModuleDestroy();
  });

  it("the pg-boss work handler delegates to runOnce()", async () => {
    const boss = fakeBoss();
    const prisma = fakePrisma();
    const cron = new ThrottlerCleanupCron(prisma as never, boss);
    await cron.onModuleInit();

    const [, handler] = boss.workCalls[0]!;
    await handler();

    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    await cron.onModuleDestroy();
  });
});

// ---------------------------------------------------------------------------
// 3. IdempotencyCleanupCron dual-mode
// ---------------------------------------------------------------------------

describe("Story · IdempotencyCleanupCron pg-boss dual-mode (issue #127 Finding 1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("registers work + schedule via pg-boss when a boss adapter is supplied", async () => {
    const boss = fakeBoss();
    const store = new InMemoryIdempotencyStoreWithCleanup();
    const cron = new IdempotencyCleanupCron(store, boss);

    await cron.onModuleInit();

    expect(boss.workCalls.length).toBe(1);
    expect(boss.scheduleCalls.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    await cron.onModuleDestroy();
  });

  it("falls back to setInterval when no boss is supplied", async () => {
    const store = new InMemoryIdempotencyStoreWithCleanup();
    const cron = new IdempotencyCleanupCron(store);

    cron.onModuleInit();

    expect(vi.getTimerCount()).toBe(1);
    cron.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isPgBossActive() reflects which mode is active", async () => {
    const boss = fakeBoss();
    const store = new InMemoryIdempotencyStoreWithCleanup();
    const cron = new IdempotencyCleanupCron(store, boss);
    expect(cron.isPgBossActive()).toBe(false);
    await cron.onModuleInit();
    expect(cron.isPgBossActive()).toBe(true);
    await cron.onModuleDestroy();
    expect(cron.isPgBossActive()).toBe(false);
  });

  it("the pg-boss work handler delegates to runOnce() and prunes expired rows", async () => {
    const boss = fakeBoss();
    const store = new InMemoryIdempotencyStoreWithCleanup();
    vi.setSystemTime(Date.UTC(2026, 4, 10, 12, 0, 0));
    const now = Date.now();
    await store.put(idempRecord("k1", now - 1_000));
    await store.put(idempRecord("k2", now + 1_000));

    const cron = new IdempotencyCleanupCron(store, boss);
    await cron.onModuleInit();

    const [, handler] = boss.workCalls[0]!;
    const result = await handler();

    // runOnce returns { cutoffMs, deleted }
    expect((result as { deleted: number }).deleted).toBe(1);
    expect(await store.get("k1")).toBeNull();
    expect(await store.get("k2")).not.toBeNull();

    await cron.onModuleDestroy();
  });
});

// ---------------------------------------------------------------------------
// 4. VerificationCleanupCron dual-mode
// ---------------------------------------------------------------------------

describe("Story · VerificationCleanupCron pg-boss dual-mode (issue #127 Finding 1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("registers work + schedule via pg-boss when a boss adapter is supplied", async () => {
    const boss = fakeBoss();
    const store = new InMemoryVerificationStore();
    const cron = new VerificationCleanupCron(store, boss);

    await cron.onModuleInit();

    expect(boss.workCalls.length).toBe(1);
    expect(boss.scheduleCalls.length).toBe(1);
    expect(vi.getTimerCount()).toBe(0);

    await cron.onModuleDestroy();
  });

  it("falls back to setInterval when no boss is supplied", async () => {
    const store = new InMemoryVerificationStore();
    const cron = new VerificationCleanupCron(store);

    cron.onModuleInit();

    expect(vi.getTimerCount()).toBe(1);
    cron.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("isPgBossActive() reflects which mode is active", async () => {
    const boss = fakeBoss();
    const store = new InMemoryVerificationStore();
    const cron = new VerificationCleanupCron(store, boss);
    expect(cron.isPgBossActive()).toBe(false);
    await cron.onModuleInit();
    expect(cron.isPgBossActive()).toBe(true);
    await cron.onModuleDestroy();
    expect(cron.isPgBossActive()).toBe(false);
  });

  it("the pg-boss work handler delegates to runOnce() and prunes stale rows", async () => {
    const boss = fakeBoss();
    const store = new InMemoryVerificationStore();
    vi.setSystemTime(Date.UTC(2026, 4, 10, 12, 0, 0));
    const now = Date.now();
    // Stale row: expired 10 days ago (past the 7-day retention window).
    await store.put({ id: "stale", identifier: "x@y", expiresAt: now - 10 * 24 * 60 * 60 * 1000 });
    // Fresh row: still within the 7-day post-expiry window.
    await store.put({ id: "fresh", identifier: "x@y", expiresAt: now + 1 * 24 * 60 * 60 * 1000 });

    const cron = new VerificationCleanupCron(store, boss);
    await cron.onModuleInit();

    const [, handler] = boss.workCalls[0]!;
    const result = await handler();

    expect((result as { deleted: number }).deleted).toBe(1);
    expect(await store.size()).toBe(1);

    await cron.onModuleDestroy();
  });
});

// ---------------------------------------------------------------------------
// 5. GeoIpRefreshCron dual-mode
// ---------------------------------------------------------------------------

describe("Story · GeoIpRefreshCron pg-boss dual-mode (issue #127 Finding 1)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("registers work + schedule via pg-boss when a boss adapter is supplied and geoip is enabled", async () => {
    const boss = fakeBoss();
    const cron = new GeoIpRefreshCron({
      enabled: true,
      provider: "dbip-lite",
      dbPath: "/tmp/test-geoip.mmdb",
      licenseKey: undefined,
      boss,
    });

    await cron.onModuleInit();

    expect(boss.workCalls.length).toBe(1);
    expect(boss.scheduleCalls.length).toBe(1);
    // pg-boss path → no setInterval registered.
    expect(vi.getTimerCount()).toBe(0);

    await cron.onModuleDestroy();
  });

  it("falls back to setInterval when no boss is supplied and geoip is enabled", async () => {
    const cron = new GeoIpRefreshCron({
      enabled: true,
      provider: "dbip-lite",
      dbPath: "/tmp/test-geoip.mmdb",
      licenseKey: undefined,
      boss: null,
    });

    cron.onModuleInit();
    // One setInterval registered for the daily tick.
    expect(vi.getTimerCount()).toBe(1);
    cron.onModuleDestroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("registers nothing when geoip feature is disabled (shouldRun=false)", async () => {
    const boss = fakeBoss();
    const cron = new GeoIpRefreshCron({
      enabled: false,
      provider: "dbip-lite",
      dbPath: "/tmp/test-geoip.mmdb",
      licenseKey: undefined,
      boss,
    });

    cron.onModuleInit();
    expect(vi.getTimerCount()).toBe(0);
    expect(boss.workCalls.length).toBe(0);
  });

  it("isPgBossActive() reflects which mode is active", async () => {
    const boss = fakeBoss();
    const cron = new GeoIpRefreshCron({
      enabled: true,
      provider: "dbip-lite",
      dbPath: "/tmp/test-geoip.mmdb",
      licenseKey: undefined,
      boss,
    });
    expect(cron.isPgBossActive()).toBe(false);
    await cron.onModuleInit();
    expect(cron.isPgBossActive()).toBe(true);
    await cron.onModuleDestroy();
    expect(cron.isPgBossActive()).toBe(false);
  });
});
