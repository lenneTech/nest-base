/**
 * Loads real dashboard metrics for `/hub/dashboard.json`.
 *
 * Runners call Prisma / the job queue / the filesystem; planners
 * format the results for `buildDashboardStatusGroups` and charts.
 */

import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { Features } from "../features/features.js";
import type { JobQueueService } from "../jobs/jobs.module.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import {
  buildSessionChartBuckets,
  computeWebhookSuccessRate,
  type SessionHourRow,
} from "./dashboard-snapshot-planner.js";

export interface DashboardAsyncMetrics {
  pendingJobCount: number;
  deadLetterCount: number;
  webhookSuccessRate: number | null;
  geoIpAgeDays: number | null;
  geoIpInstalled: boolean;
}

export interface DashboardSessionsChart {
  available: boolean;
  buckets: ReturnType<typeof buildSessionChartBuckets>;
}

export async function loadDashboardAsyncMetrics(input: {
  prisma: PrismaService;
  jobs: JobQueueService;
  features: Features;
}): Promise<DashboardAsyncMetrics> {
  const [jobPending, deadLetters, webhookRate, geo] = await Promise.all([
    loadPendingJobCount(input.jobs, input.features.jobs.enabled),
    loadDeadLetterCount(input.prisma, input.features.email.enabled),
    loadWebhookSuccessRate(input.prisma, input.features.webhooks.enabled),
    loadGeoIpAgeDays(input.features.geoIp.enabled, input.features.geoIp.dbPath),
  ]);

  return {
    pendingJobCount: jobPending,
    deadLetterCount: deadLetters,
    webhookSuccessRate: webhookRate,
    geoIpAgeDays: geo.ageDays,
    geoIpInstalled: geo.installed,
  };
}

export async function loadDashboardSessionsChart(
  prisma: PrismaService,
): Promise<DashboardSessionsChart> {
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `WITH hours AS (
         SELECT generate_series(
           date_trunc('hour', NOW() - INTERVAL '23 hours'),
           date_trunc('hour', NOW()),
           INTERVAL '1 hour'
         ) AS hour_start
       )
       SELECT h.hour_start AS "hourStart",
              COALESCE((
                SELECT COUNT(*)::int
                  FROM sessions s
                 WHERE s.created_at >= h.hour_start
                   AND s.created_at < h.hour_start + INTERVAL '1 hour'
              ), 0) AS "newLogins",
              COALESCE((
                SELECT COUNT(*)::int
                  FROM sessions s
                 WHERE s.created_at <= h.hour_start + INTERVAL '1 hour'
                   AND s.expires_at > h.hour_start
              ), 0) AS active
         FROM hours h
         ORDER BY h.hour_start ASC`,
    )) as Array<{ hourStart: Date; newLogins: number; active: number }>;

    const mapped: SessionHourRow[] = rows.map((r) => ({
      hourStart: r.hourStart,
      newLogins: r.newLogins,
      active: r.active,
    }));

    const buckets = buildSessionChartBuckets(mapped);
    const hasData = buckets.some((b) => b.active > 0 || b.newLogins > 0);
    return { available: hasData, buckets };
  } catch {
    return { available: false, buckets: [] };
  }
}

async function loadPendingJobCount(jobs: JobQueueService, jobsEnabled: boolean): Promise<number> {
  if (!jobsEnabled) return 0;
  try {
    const aggregates = await jobs.getAggregates();
    const t = aggregates.totals;
    // Only count genuine backlog (created) and in-flight (active) jobs.
    // BullMQ maps its "delayed" state to `retry` in StateCounts — this includes
    // scheduled cron/repeat jobs waiting for their next fire time, which are
    // always in delayed state between runs and must NOT be treated as pending.
    // Permanent failures are tracked separately via deadLetterCount.
    return t.created + t.active;
  } catch {
    return 0;
  }
}

async function loadDeadLetterCount(prisma: PrismaService, emailEnabled: boolean): Promise<number> {
  if (!emailEnabled) return 0;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM email_outbox WHERE status = 'DEAD_LETTER'::"EmailOutboxStatus"`,
    )) as Array<{ count: number }>;
    return rows[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

async function loadWebhookSuccessRate(
  prisma: PrismaService,
  webhooksEnabled: boolean,
): Promise<number | null> {
  if (!webhooksEnabled) return null;
  try {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT status::text AS status, COUNT(*)::int AS count
         FROM webhook_deliveries
        WHERE is_test = false
          AND updated_at >= NOW() - INTERVAL '24 hours'
        GROUP BY status`,
    )) as Array<{ status: string; count: number }>;

    let delivered = 0;
    let failed = 0;
    let pending = 0;
    for (const row of rows) {
      if (row.status === "DELIVERED") delivered = row.count;
      else if (row.status === "FAILED") failed = row.count;
      else if (row.status === "PENDING") pending = row.count;
    }
    return computeWebhookSuccessRate({ delivered, failed, pending });
  } catch {
    return null;
  }
}

async function loadGeoIpAgeDays(
  enabled: boolean,
  dbPath: string,
): Promise<{ ageDays: number | null; installed: boolean }> {
  if (!enabled) return { ageDays: null, installed: false };
  const absolute = resolve(process.cwd(), dbPath);
  try {
    const st = await stat(absolute);
    const ageMs = Date.now() - st.mtimeMs;
    return { ageDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)), installed: true };
  } catch {
    return { ageDays: null, installed: false };
  }
}
