import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  type PgBossLike,
  PgBossScheduledJobScheduler,
  buildPgBossScheduledJobsPlan,
} from "../../src/core/jobs/scheduled-job-pgboss-scheduler.js";
import type { ScheduledJobEntry } from "../../src/core/jobs/scheduled-job.registry.js";

/**
 * Story · pg-boss-driven cron scheduling for the @ScheduledJob registry
 * (CF.JOBS.01+02 — Finding 12 from iter-84 reviewer).
 *
 * Iter-95 added the runtime registry that walks every `@ScheduledJob`
 * method via DiscoveryService. Iter-96 turns the registry into actual
 * cron via pg-boss: when `DATABASE_URL` is set + `FEATURE_JOBS_PG_BOSS=true`
 * the `PgBossScheduledJobScheduler` lifecycle service starts pg-boss,
 * iterates the registry, and calls
 * `boss.work(name, handler) + boss.schedule(name, cron)` per entry.
 *
 * Layered surface:
 *  1. `buildPgBossScheduledJobsPlan(input)` — pure planner (returned
 *     work + schedule calls); test-friendly without a live boss.
 *  2. `PgBossScheduledJobScheduler` — runner consuming the plan + a
 *     `PgBossLike` adapter (so tests inject a spy).
 */
describe("Story · pg-boss scheduled job scheduler", () => {
  describe("buildPgBossScheduledJobsPlan (pure planner)", () => {
    function entry(name: string, cron: string): ScheduledJobEntry {
      return {
        name,
        cron,
        source: `Test.${name}`,
        run: async () => ({ name }),
      };
    }

    it("returns one work-handler and one schedule per entry", () => {
      const plan = buildPgBossScheduledJobsPlan({
        entries: [entry("apiKeyExpiry", "0 8 * * *"), entry("gdprErasure", "0 4 * * *")],
      });
      expect(plan.work).toHaveLength(2);
      expect(plan.work[0]?.name).toBe("apiKeyExpiry");
      expect(plan.schedule).toHaveLength(2);
      expect(plan.schedule[0]).toEqual({ name: "apiKeyExpiry", cron: "0 8 * * *" });
      expect(plan.schedule[1]).toEqual({ name: "gdprErasure", cron: "0 4 * * *" });
    });

    it("produces an empty plan when the registry is empty", () => {
      const plan = buildPgBossScheduledJobsPlan({ entries: [] });
      expect(plan.work).toEqual([]);
      expect(plan.schedule).toEqual([]);
    });

    it("each work entry's handler invokes the registered run() closure", async () => {
      const captured: string[] = [];
      const e: ScheduledJobEntry = {
        name: "apiKeyExpiry",
        cron: "0 8 * * *",
        source: "Test.apiKeyExpiry",
        run: async () => {
          captured.push("ran");
          return { notified: 7 };
        },
      };
      const plan = buildPgBossScheduledJobsPlan({ entries: [e] });
      await plan.work[0]!.handler();
      expect(captured).toEqual(["ran"]);
    });
  });

  describe("PgBossScheduledJobScheduler (runner)", () => {
    interface RecordedCall {
      readonly kind: "start" | "work" | "schedule" | "stop";
      readonly args?: readonly unknown[];
    }

    let calls: RecordedCall[];
    let bossSpy: PgBossLike;

    beforeEach(() => {
      calls = [];
      bossSpy = {
        async start() {
          calls.push({ kind: "start" });
        },
        async work(name, handler) {
          calls.push({ kind: "work", args: [name, handler] });
        },
        async schedule(name, cron) {
          calls.push({ kind: "schedule", args: [name, cron] });
        },
        async stop() {
          calls.push({ kind: "stop" });
        },
      };
    });

    afterEach(() => {
      calls = [];
    });

    it("onApplicationBootstrap: starts boss, registers work + schedule per registry entry", async () => {
      const registry = {
        list: () => [
          {
            name: "apiKeyExpiry",
            cron: "0 8 * * *",
            source: "Test.apiKeyExpiry",
            run: async () => ({}),
          },
        ],
        runOnce: async () => ({}),
        has: () => true,
      };
      const scheduler = new PgBossScheduledJobScheduler({ boss: bossSpy, registry });
      await scheduler.onApplicationBootstrap();

      const kinds = calls.map((c) => c.kind);
      expect(kinds[0]).toBe("start");
      expect(kinds).toContain("work");
      expect(kinds).toContain("schedule");

      const workCall = calls.find((c) => c.kind === "work");
      expect(workCall?.args?.[0]).toBe("apiKeyExpiry");
      const scheduleCall = calls.find((c) => c.kind === "schedule");
      expect(scheduleCall?.args).toEqual(["apiKeyExpiry", "0 8 * * *"]);
    });

    it("onModuleDestroy: stops boss", async () => {
      const registry = {
        list: () => [],
        runOnce: async () => ({}),
        has: () => false,
      };
      const scheduler = new PgBossScheduledJobScheduler({ boss: bossSpy, registry });
      await scheduler.onApplicationBootstrap();
      await scheduler.onModuleDestroy();
      expect(calls.map((c) => c.kind)).toContain("stop");
    });

    it("missing boss = scheduler is a no-op (test mode)", async () => {
      const registry = {
        list: () => [
          {
            name: "apiKeyExpiry",
            cron: "0 8 * * *",
            source: "Test.apiKeyExpiry",
            run: async () => ({}),
          },
        ],
        runOnce: async () => ({}),
        has: () => true,
      };
      const scheduler = new PgBossScheduledJobScheduler({ boss: null, registry });
      await scheduler.onApplicationBootstrap();
      await scheduler.onModuleDestroy();
      // Scheduler did NOT touch any boss surface (boss was null).
      expect(calls).toEqual([]);
    });
  });
});
