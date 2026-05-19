import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { JobQueueService } from "../jobs/jobs.module.js";
import {
  wireBullMQCleanupRepeat,
  type WireCleanupRepeatResult,
} from "../jobs/wire-bullmq-cleanup-repeat.js";
import { PrismaService } from "../prisma/prisma.service.js";

/**
 * ThrottlerCleanupCron — periodic prune of expired
 * `throttler_records` rows (iter-198 follow-up to the iter-77
 * migration's documented promise).
 *
 * Migration `20260504160000_throttler_records/migration.sql:18-21`
 * stated: "a periodic background sweep deletes rows whose
 * `expires_at < now() - INTERVAL '1 day'` ... default cadence is 1 hour."
 * The migration shipped + the matching `throttler_records_expires_at_idx`
 * index landed, but no cron was wired. Iter-198 closes the gap.
 *
 * Cadence: hourly (per the migration's docstring), pruning rows
 * whose `expires_at` is more than 1 day older than `now()` — the
 * 1-day buffer matches the migration's pin and is conservative
 * (rate-limit windows are minutes-to-hours, never days, so anything
 * past `now - 1d` is dead weight).
 *
 * Mirrors the iter-181 / iter-184 / iter-193 cleanup-cron contract:
 * `OnModuleInit` immediate-run + `setInterval`, `OnModuleDestroy`
 * clears the timer, error-isolated `runOnce()` returning
 * `{cutoffMs, deleted}` with `null` on DB outage. The matching
 * `throttler_records_expires_at_idx` index makes the prune
 * O(log N).
 *
 * Multi-replica safety: use a distributed job scheduler (e.g. BullMQ
 * repeatable jobs) when deploying across multiple replicas. The bare
 * setInterval here is the single-process path which is correct for
 * the default single-container deployment.
 */

export const THROTTLER_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_THROTTLER_RETENTION_DAYS = 1;

@Injectable()
export class ThrottlerCleanupCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ThrottlerCleanup");
  private wire?: WireCleanupRepeatResult;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly jobQueue?: JobQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    void this.runOnce();
    this.wire = await wireBullMQCleanupRepeat(
      this.jobQueue,
      "throttler",
      () => {
        void this.runOnce();
      },
      THROTTLER_CLEANUP_INTERVAL_MS,
    );
  }

  /** Public so tests can call it deterministically. */
  async runOnce(): Promise<{ cutoffMs: number; deleted: number | null }> {
    const cutoffMs = Date.now() - DEFAULT_THROTTLER_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    try {
      // Raw SQL because the throttler table is managed via
      // `$queryRawUnsafe` / `$executeRawUnsafe` in the backend;
      // there's no Prisma model delegate for it.
      const result = await this.prisma.$executeRawUnsafe(
        `DELETE FROM "throttler_records" WHERE "expires_at" < $1`,
        new Date(cutoffMs),
      );
      const deleted = typeof result === "number" ? result : 0;
      this.logger.log(`cleanup-run: cutoffMs=${cutoffMs} deleted=${deleted}`);
      return { cutoffMs, deleted };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`cleanup-error: cutoffMs=${cutoffMs} error="${msg}"`);
      return { cutoffMs, deleted: null };
    }
  }

  onModuleDestroy(): void {
    this.wire?.stop?.();
    this.wire = undefined;
  }
}
