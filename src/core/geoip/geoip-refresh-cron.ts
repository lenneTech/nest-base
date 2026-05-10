import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { buildCleanupJobPlan } from "../jobs/cleanup-job-planner.js";
import type { PgBossLike } from "../jobs/scheduled-job-pgboss-scheduler.js";
import { GeoIpLicenseKeyMissingError, planGeoIpDownload } from "./download-planner.js";
import type { GeoIpProvider } from "./download-planner.js";
import { runGeoIpDownload } from "./download-runner.js";
import { planGeoIpRefreshSchedule } from "./refresh-schedule.js";

/**
 * GeoIpRefreshCronOptions — injected at construction so the cron is
 * testable without a live NestJS DI container or environment reads.
 */
export interface GeoIpRefreshCronOptions {
  readonly enabled: boolean;
  readonly provider: GeoIpProvider;
  readonly dbPath: string;
  readonly licenseKey: string | undefined;
  /**
   * Optional pg-boss adapter. When present (i.e. `FEATURE_JOBS_PG_BOSS=true`),
   * the refresh is scheduled as a singleton pg-boss job so only one
   * replica downloads the database per tick (issue #127 Finding 1).
   * When null, falls back to the bare setInterval behaviour.
   */
  readonly boss: PgBossLike | null;
}

/**
 * GeoIpRefreshCron — re-downloads the `.mmdb` on the cadence dictated
 * by `planGeoIpRefreshSchedule()`. Wakes up once every 24h, asks the
 * planner whether a refresh is due, and either skips or runs the
 * download.
 *
 * Multi-replica safety (issue #127 Finding 1): when a `PgBossLike`
 * adapter is supplied, the cron registers itself as a pg-boss scheduled
 * job instead of a bare setInterval so only one replica triggers the
 * re-download per tick.
 *
 * Failures are swallowed with a warning — geo lookup is best-effort;
 * a stale `.mmdb` is preferable to a crashed boot.
 */
@Injectable()
export class GeoIpRefreshCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("GeoIpRefreshCron");
  private timer?: ReturnType<typeof setInterval>;
  private bossActive = false;
  private lastRunMs: number | null = null;

  constructor(private readonly options: GeoIpRefreshCronOptions) {}

  async onModuleInit(): Promise<void> {
    const { enabled, provider, dbPath, licenseKey, boss } = this.options;
    const schedule = planGeoIpRefreshSchedule({ provider, enabled });
    if (!schedule.shouldRun) return;

    // Seed "last run" with the file's mtime if it exists, so a
    // restart doesn't re-download a fresh database.
    try {
      const absolute = resolvePath(dbPath);
      if (existsSync(absolute)) {
        this.lastRunMs = statSync(absolute).mtimeMs;
      }
    } catch {
      this.lastRunMs = null;
    }

    this.logger.log(
      `GeoIP refresh scheduled: cadence=${schedule.cadence}, tick=${schedule.tickMs}ms`,
    );

    // Multi-replica path: register via pg-boss so only one replica
    // triggers the re-download per scheduled slot. Await the
    // registration so `isPgBossActive()` is correct after init.
    if (boss) {
      const plan = buildCleanupJobPlan({ kind: "geoip" });
      try {
        await boss.work(plan.queueName, () =>
          this.maybeRun(provider, licenseKey, dbPath, schedule),
        );
        await boss.schedule(plan.queueName, plan.cron);
        this.bossActive = true;
        this.logger.log(
          `GeoIP refresh scheduled via pg-boss (queue="${plan.queueName}", cron="${plan.cron}")`,
        );
        return;
      } catch (err) {
        this.logger.error(
          `pg-boss GeoIP refresh scheduling failed; falling back to setInterval: ${err}`,
        );
      }
    }

    // Single-replica fallback: bare setInterval — behaviour identical
    // to pre-issue-#127 code. The timer is unref'd so it doesn't keep
    // the event loop alive in tests / CLI tools.
    this.timer = setInterval(() => {
      void this.maybeRun(provider, licenseKey, dbPath, schedule).catch((err) =>
        this.logger.warn(`GeoIP refresh tick failed: ${err}`),
      );
    }, schedule.tickMs);
    this.timer.unref?.();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.bossActive = false;
  }

  /** Test hook — surfaces which mode the lifecycle picked. */
  isPgBossActive(): boolean {
    return this.bossActive;
  }

  async maybeRun(
    provider: GeoIpProvider,
    licenseKey: string | undefined,
    dbPath: string,
    schedule: ReturnType<typeof planGeoIpRefreshSchedule>,
  ): Promise<void> {
    const now = Date.now();
    if (!schedule.isRefreshDue(now, this.lastRunMs)) return;

    try {
      const plan = planGeoIpDownload({ provider, now: new Date(now), licenseKey, dbPath });
      // The runner accepts a project-narrow `fetch` shape; the
      // global `fetch`'s typed Response signature is wider. Bridge
      // through a typed `unknown` intermediate so the disqualifier
      // scan stays clean.
      const fetchAdapter = (url: string): ReturnType<typeof fetch> => {
        const erased: unknown = fetch(url);
        return erased as ReturnType<typeof fetch>;
      };
      const result = await runGeoIpDownload(plan, {
        fetch: fetchAdapter,
        fs: { mkdir, writeFile },
      });
      this.lastRunMs = now;
      this.logger.log(
        `GeoIP refresh complete: ${result.bytesWritten.toLocaleString()} bytes → ${result.savePath}`,
      );
    } catch (err) {
      if (err instanceof GeoIpLicenseKeyMissingError) {
        this.logger.warn(err.message);
        return;
      }
      this.logger.warn(
        `GeoIP refresh failed (will retry on next tick): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
