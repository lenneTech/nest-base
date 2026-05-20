import { describe, expect, it, vi } from "vitest";

import {
  loadDashboardAsyncMetrics,
  loadDashboardSessionsChart,
} from "../../src/core/dx/dashboard-metrics-loader.js";
import { FeaturesSchema } from "../../src/core/features/features.js";
import type { JobQueueService } from "../../src/core/jobs/jobs.module.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · dashboard metrics loader — thin runner that aggregates
 * Prisma / job-queue / filesystem signals for `/hub/dashboard.json`.
 */

function fakePrisma(queryImpl: (sql: string) => unknown): PrismaService {
  return {
    $queryRawUnsafe: vi.fn(async (sql: string) => queryImpl(sql)),
  } as unknown as PrismaService;
}

function fakeJobs(totals: { created: number; active: number; retry: number }): JobQueueService {
  return {
    getAggregates: vi.fn(async () => ({
      totals,
      queues: [],
    })),
  } as unknown as JobQueueService;
}

describe("Story · dashboard metrics loader", () => {
  describe("loadDashboardAsyncMetrics", () => {
    it("returns null webhook rate when webhooks are disabled", async () => {
      const features = FeaturesSchema.parse({ webhooks: { enabled: false } });
      const metrics = await loadDashboardAsyncMetrics({
        prisma: fakePrisma(() => []),
        jobs: fakeJobs({ created: 0, active: 0, retry: 0 }),
        features,
      });
      expect(metrics.webhookSuccessRate).toBeNull();
      expect(metrics.pendingJobCount).toBe(0);
    });

    it("computes webhook success rate from delivery status rows", async () => {
      const features = FeaturesSchema.parse({ webhooks: { enabled: true } });
      const prisma = fakePrisma((sql) => {
        if (sql.includes("webhook_deliveries")) {
          return [
            { status: "DELIVERED", count: 9 },
            { status: "FAILED", count: 1 },
          ];
        }
        return [];
      });
      const metrics = await loadDashboardAsyncMetrics({
        prisma,
        jobs: fakeJobs({ created: 0, active: 0, retry: 0 }),
        features,
      });
      expect(metrics.webhookSuccessRate).toBe(0.9);
    });

    it("sums pending job states when jobs are enabled", async () => {
      const features = FeaturesSchema.parse({ jobs: { enabled: true } });
      const metrics = await loadDashboardAsyncMetrics({
        prisma: fakePrisma(() => []),
        jobs: fakeJobs({ created: 2, active: 3, retry: 1 }),
        features,
      });
      expect(metrics.pendingJobCount).toBe(6);
    });
  });

  describe("loadDashboardSessionsChart", () => {
    it("marks chart unavailable when SQL fails", async () => {
      const prisma = {
        $queryRawUnsafe: vi.fn(async () => {
          throw new Error("relation sessions does not exist");
        }),
      } as unknown as PrismaService;

      const chart = await loadDashboardSessionsChart(prisma);
      expect(chart.available).toBe(false);
      expect(chart.buckets).toEqual([]);
    });

    it("marks chart unavailable when all buckets are zero", async () => {
      const now = new Date("2026-05-20T12:00:00.000Z");
      const prisma = fakePrisma(() =>
        Array.from({ length: 24 }, (_, i) => ({
          hourStart: new Date(now.getTime() - (23 - i) * 60 * 60 * 1000),
          newLogins: 0,
          active: 0,
        })),
      );

      const chart = await loadDashboardSessionsChart(prisma);
      expect(chart.available).toBe(false);
      expect(chart.buckets).toHaveLength(24);
    });

    it("returns buckets when session activity exists", async () => {
      const fixedNow = Date.parse("2026-05-20T12:30:00.000Z");
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(fixedNow);
      const hourStart = new Date(fixedNow);
      hourStart.setMinutes(0, 0, 0);

      const prisma = fakePrisma(() => [{ hourStart, newLogins: 3, active: 10 }]);

      const chart = await loadDashboardSessionsChart(prisma);
      nowSpy.mockRestore();

      expect(chart.available).toBe(true);
      expect(chart.buckets.some((b) => b.newLogins === 3 && b.active === 10)).toBe(true);
    });
  });
});
