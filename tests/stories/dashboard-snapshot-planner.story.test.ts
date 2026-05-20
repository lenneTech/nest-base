import { describe, expect, it } from "vitest";

import {
  buildSessionChartBuckets,
  computeWebhookSuccessRate,
} from "../../src/core/dx/dashboard-snapshot-planner.js";

/**
 * Story · dashboard snapshot planners — pure chart/rate helpers for
 * `/hub/dashboard.json`. No I/O; deterministic given the same input.
 */

describe("Story · dashboard snapshot planner", () => {
  describe("computeWebhookSuccessRate", () => {
    it("returns delivered / total when deliveries exist", () => {
      expect(computeWebhookSuccessRate({ delivered: 95, failed: 3, pending: 2 })).toBe(0.95);
    });

    it("returns null when there were no deliveries in the window", () => {
      expect(computeWebhookSuccessRate({ delivered: 0, failed: 0, pending: 0 })).toBeNull();
    });

    it("counts pending deliveries in the denominator", () => {
      expect(computeWebhookSuccessRate({ delivered: 1, failed: 0, pending: 1 })).toBe(0.5);
    });
  });

  describe("buildSessionChartBuckets", () => {
    const nowMs = Date.parse("2026-05-20T15:30:00.000Z");

    it("returns 24 hourly buckets oldest → newest", () => {
      const buckets = buildSessionChartBuckets([], nowMs);
      expect(buckets).toHaveLength(24);
      expect(buckets.every((b) => /^\d{2}:00$/.test(b.hour))).toBe(true);
    });

    it("zero-fills missing hours", () => {
      const hourStart = new Date(nowMs - 2 * 60 * 60 * 1000);
      hourStart.setMinutes(0, 0, 0);
      const buckets = buildSessionChartBuckets([{ hourStart, newLogins: 4, active: 12 }], nowMs);
      expect(buckets.every((b) => typeof b.hour === "string")).toBe(true);
      expect(buckets.some((b) => b.newLogins === 4 && b.active === 12)).toBe(true);
      expect(buckets.filter((b) => b.newLogins === 0 && b.active === 0)).toHaveLength(23);
    });

    it("is deterministic for the same rows and clock", () => {
      const rows = [
        {
          hourStart: new Date(nowMs - 60 * 60 * 1000),
          newLogins: 2,
          active: 5,
        },
      ];
      const a = buildSessionChartBuckets(rows, nowMs);
      const b = buildSessionChartBuckets(rows, nowMs);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });
  });
});
