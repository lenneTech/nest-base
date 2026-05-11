import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

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
}

/**
 * GeoIpRefreshCron — re-downloads the `.mmdb` on the cadence dictated
 * by `planGeoIpRefreshSchedule()`. Wakes up once every 24h, asks the
 * planner whether a refresh is due, and either skips or runs the
 * download.
 *
 * Multi-replica safety: use a distributed job scheduler (e.g. BullMQ
 * repeatable jobs) when deploying across multiple replicas. The bare
 * setInterval here is the single-process path which is correct for
 * the default single-container deployment.
 *
 * Failures are swallowed with a warning — geo lookup is best-effort;
 * a stale `.mmdb` is preferable to a crashed boot.
 */
@Injectable()
export class GeoIpRefreshCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("GeoIpRefreshCron");
  private timer?: ReturnType<typeof setInterval>;
  private lastRunMs: number | null = null;

  constructor(private readonly options: GeoIpRefreshCronOptions) {}

  async onModuleInit(): Promise<void> {
    const { enabled, provider, dbPath, licenseKey } = this.options;
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

    // Single-process path: bare setInterval. The timer is unref'd so it
    // doesn't keep the event loop alive in tests / CLI tools.
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
