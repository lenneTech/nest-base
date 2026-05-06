import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { GdprErasureRunner } from "../../src/core/gdpr/gdpr-erasure.runner.js";
import {
  planGdprGracePeriodErasures,
  type PendingErasureRecord,
} from "../../src/core/gdpr/gdpr-grace.planner.js";
import { getScheduledJobs } from "../../src/core/jobs/scheduled-job.decorator.js";

/**
 * Story · GDPR 30-day grace-period erasure (CF.GDPR.04).
 *
 * The PRD's "30-day grace period" requires that when a user requests
 * account deletion via `DELETE /me/account`, the actual erasure runs
 * 30 days later. The runner is a `@ScheduledJob`-decorated daily
 * cron that consumes the pure planner (`planGdprGracePeriodErasures`)
 * and executes the project's erasure mechanism.
 *
 * This story covers two layers:
 *   1. The pure planner — input/output contract pinned with synthetic
 *      records + an injectable clock.
 *   2. The runner — `@ScheduledJob` metadata + closure-injected
 *      executor + per-record failure isolation.
 */
const ROOT = resolve(__dirname, "..", "..");
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * ONE_DAY_MS;

describe("Story · GDPR grace-period planner", () => {
  it("flags records whose grace window has elapsed as ready for erasure", () => {
    const now = Date.now();
    const pending: PendingErasureRecord[] = [
      // Requested 31 days ago → past grace
      { id: "p1", userId: "u1", requestedAt: now - 31 * ONE_DAY_MS },
      // Requested 5 days ago → still in grace
      { id: "p2", userId: "u2", requestedAt: now - 5 * ONE_DAY_MS },
    ];
    const plan = planGdprGracePeriodErasures({ pending, clock: () => now });
    expect(plan.readyForErasure).toHaveLength(1);
    expect(plan.readyForErasure[0]?.id).toBe("p1");
    expect(plan.stillInGrace).toHaveLength(1);
    expect(plan.skipped).toHaveLength(0);
  });

  it("default grace window is 30 days (PRD pin)", () => {
    const now = Date.now();
    // Exactly at the 30-day boundary — should be ready.
    const pending: PendingErasureRecord[] = [
      { id: "p1", userId: "u1", requestedAt: now - THIRTY_DAYS_MS },
    ];
    const plan = planGdprGracePeriodErasures({ pending, clock: () => now });
    expect(plan.readyForErasure).toHaveLength(1);
    expect(plan.readyForErasure[0]?.graceExpiredAt).toBe(now - THIRTY_DAYS_MS + THIRTY_DAYS_MS);
  });

  it("skips cancelled records", () => {
    const now = Date.now();
    const pending: PendingErasureRecord[] = [
      {
        id: "p1",
        userId: "u1",
        requestedAt: now - 60 * ONE_DAY_MS,
        cancelledAt: now - 30 * ONE_DAY_MS,
      },
    ];
    const plan = planGdprGracePeriodErasures({ pending, clock: () => now });
    expect(plan.readyForErasure).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });

  it("skips already-completed records (idempotent re-tick)", () => {
    const now = Date.now();
    const pending: PendingErasureRecord[] = [
      {
        id: "p1",
        userId: "u1",
        requestedAt: now - 60 * ONE_DAY_MS,
        completedAt: now - 30 * ONE_DAY_MS,
      },
    ];
    const plan = planGdprGracePeriodErasures({ pending, clock: () => now });
    expect(plan.readyForErasure).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });

  it("rejects negative grace periods", () => {
    expect(() =>
      planGdprGracePeriodErasures({
        pending: [],
        gracePeriodMs: -1,
      }),
    ).toThrow(/non-negative/);
  });

  it("staging projects can override the grace window via gracePeriodMs", () => {
    const now = Date.now();
    const pending: PendingErasureRecord[] = [
      { id: "p1", userId: "u1", requestedAt: now - 6 * ONE_DAY_MS },
    ];
    // 5-day staging window → record is past grace
    const plan = planGdprGracePeriodErasures({
      pending,
      clock: () => now,
      gracePeriodMs: 5 * ONE_DAY_MS,
    });
    expect(plan.readyForErasure).toHaveLength(1);
  });
});

describe("Story · GdprErasureRunner", () => {
  it("registers @ScheduledJob metadata with name=gdprErasure + daily cron", () => {
    const meta = getScheduledJobs(GdprErasureRunner.prototype);
    expect(meta).toHaveLength(1);
    expect(meta[0]?.name).toBe("gdprErasure");
    expect(meta[0]?.cron).toBe("0 4 * * *");
    expect(meta[0]?.methodName).toBe("tick");
  });

  it("erases users whose grace has elapsed + advances completedAt watermark", async () => {
    const now = Date.now();
    const erased: string[] = [];
    const watermarks: Array<{ id: string; atMs: number }> = [];
    const runner = new GdprErasureRunner({
      readPending: async () => [
        { id: "p1", userId: "u1", requestedAt: now - 31 * ONE_DAY_MS },
        { id: "p2", userId: "u2", requestedAt: now - 5 * ONE_DAY_MS }, // in-grace
      ],
      eraseUser: async (c) => {
        erased.push(c.userId);
      },
      markCompleted: async (id, atMs) => {
        watermarks.push({ id, atMs });
      },
      clock: () => now,
    });
    const result = await runner.tick();
    expect(result.erased).toBe(1);
    expect(result.stillInGrace).toBe(1);
    expect(result.skipped).toBe(0);
    expect(erased).toEqual(["u1"]);
    expect(watermarks).toEqual([{ id: "p1", atMs: now }]);
  });

  it("isolates a per-record erasure failure (logged, watermark not advanced, batch continues)", async () => {
    const now = Date.now();
    const erased: string[] = [];
    const watermarks: string[] = [];
    const runner = new GdprErasureRunner({
      readPending: async () => [
        { id: "p1", userId: "u1", requestedAt: now - 31 * ONE_DAY_MS },
        { id: "p2", userId: "u2", requestedAt: now - 32 * ONE_DAY_MS },
      ],
      eraseUser: async (c) => {
        erased.push(c.userId);
        if (c.userId === "u1") throw new Error("FK violation");
      },
      markCompleted: async (id) => {
        watermarks.push(id);
      },
      clock: () => now,
    });
    const result = await runner.tick();
    expect(erased).toHaveLength(2); // both attempted
    expect(result.erased).toBe(1);
    expect(watermarks).toEqual(["p2"]); // only u2's watermark advanced
  });

  describe("GdprModule registration", () => {
    it("registers GdprErasureRunner as a NestJS provider so DiscoveryService picks it up", () => {
      const moduleSrc = readFileSync(resolve(ROOT, "src/core/gdpr/gdpr.module.ts"), "utf8");
      expect(moduleSrc).toContain("GdprErasureRunner");
      expect(moduleSrc).toContain("gdpr-erasure.runner.js");
      expect(moduleSrc).toMatch(/provide:\s*GdprErasureRunner/);
      expect(moduleSrc).toMatch(/exports:.*GdprErasureRunner/s);
    });
  });
});
