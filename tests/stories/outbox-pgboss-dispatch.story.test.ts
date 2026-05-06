/**
 * Story · OutboxWorkerLifecycle dual-mode tick (CF.JOBS.01 / CF.RT.04 —
 * iter-116). Verifies the lifecycle picks pg-boss when bound + falls
 * back to setInterval otherwise. The audit-finding asks for
 * "FEATURE_JOBS_PG_BOSS=false → setInterval; on → boss.schedule".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OUTBOX_PGBOSS_CRON,
  OUTBOX_PGBOSS_QUEUE,
  OutboxWorkerLifecycle,
} from "../../src/core/outbox/outbox.module.js";
import type { OutboxStorage } from "../../src/core/outbox/outbox.js";
import type { OutboxDispatcher } from "../../src/core/outbox/outbox-worker.js";
import type { PgBossLike } from "../../src/core/jobs/scheduled-job-pgboss-scheduler.js";

function fakeStorage(): OutboxStorage {
  return {
    append: vi.fn(async () => {}),
    claimBatch: vi.fn(async () => []),
    markProcessed: vi.fn(async () => true),
  };
}

function fakeBoss(): PgBossLike & { workCalls: unknown[][]; scheduleCalls: unknown[][] } {
  const workCalls: unknown[][] = [];
  const scheduleCalls: unknown[][] = [];
  return {
    workCalls,
    scheduleCalls,
    start: vi.fn(async () => undefined),
    work: vi.fn(async (...args) => {
      workCalls.push(args);
    }),
    schedule: vi.fn(async (...args) => {
      scheduleCalls.push(args);
    }),
    stop: vi.fn(async () => undefined),
  };
}

describe("Story · OutboxWorkerLifecycle dual-mode tick", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it("schedules via pg-boss when the boss adapter is bound", async () => {
    const boss = fakeBoss();
    const lifecycle = new OutboxWorkerLifecycle(
      fakeStorage(),
      [] satisfies OutboxDispatcher[],
      boss,
    );
    await lifecycle.onModuleInit();
    expect(lifecycle.isPgBossActive()).toBe(true);
    expect(boss.workCalls.length).toBe(1);
    expect(boss.workCalls[0]?.[0]).toBe(OUTBOX_PGBOSS_QUEUE);
    expect(boss.scheduleCalls[0]?.[0]).toBe(OUTBOX_PGBOSS_QUEUE);
    expect(boss.scheduleCalls[0]?.[1]).toBe(OUTBOX_PGBOSS_CRON);
    await lifecycle.onModuleDestroy();
    expect(lifecycle.isPgBossActive()).toBe(false);
  });

  it("falls back to setInterval when no boss is bound", async () => {
    const lifecycle = new OutboxWorkerLifecycle(
      fakeStorage(),
      [] satisfies OutboxDispatcher[],
      null,
    );
    await lifecycle.onModuleInit();
    expect(lifecycle.isPgBossActive()).toBe(false);
    // Advance the clock — setInterval would have been registered.
    vi.advanceTimersByTime(2_000);
    await lifecycle.onModuleDestroy();
  });

  it("falls back to setInterval when boss.work throws", async () => {
    const boss = fakeBoss();
    boss.work = vi.fn(async () => {
      throw new Error("boss explosion");
    });
    const lifecycle = new OutboxWorkerLifecycle(
      fakeStorage(),
      [] satisfies OutboxDispatcher[],
      boss,
    );
    await lifecycle.onModuleInit();
    expect(lifecycle.isPgBossActive()).toBe(false);
    await lifecycle.onModuleDestroy();
  });

  it("registers exactly one work + one schedule entry per init", async () => {
    const boss = fakeBoss();
    const lifecycle = new OutboxWorkerLifecycle(
      fakeStorage(),
      [] satisfies OutboxDispatcher[],
      boss,
    );
    await lifecycle.onModuleInit();
    expect(boss.workCalls.length).toBe(1);
    expect(boss.scheduleCalls.length).toBe(1);
    await lifecycle.onModuleDestroy();
  });
});
