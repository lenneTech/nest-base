import {
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { buildCleanupJobPlan } from "../jobs/cleanup-job-planner.js";
import type { PgBossLike } from "../jobs/scheduled-job-pgboss-scheduler.js";
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
 * Multi-replica safety (issue #127 Finding 1): when a `PgBossLike`
 * adapter is injected (i.e. `FEATURE_JOBS_PG_BOSS=true`), the cron
 * registers itself as a pg-boss scheduled job instead of a bare
 * setInterval so only one replica runs the cleanup per tick. The
 * `singletonKey` in the plan is the pg-boss advisory-lock key that
 * guarantees at-most-one execution across all replicas.
 */

export const THROTTLER_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_THROTTLER_RETENTION_DAYS = 1;

@Injectable()
export class ThrottlerCleanupCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ThrottlerCleanup");
  private timer?: ReturnType<typeof setInterval>;
  private bossActive = false;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly boss: PgBossLike | null = null,
  ) {}

  async onModuleInit(): Promise<void> {
    // Multi-replica path: delegate to pg-boss so only one replica
    // executes the cleanup per scheduled slot (issue #127 Finding 1).
    if (this.boss) {
      const plan = buildCleanupJobPlan({ kind: "throttler" });
      try {
        await this.boss.work(plan.queueName, () => this.runOnce());
        await this.boss.schedule(plan.queueName, plan.cron);
        this.bossActive = true;
        this.logger.log(
          `throttler cleanup scheduled via pg-boss (queue="${plan.queueName}", cron="${plan.cron}")`,
        );
        return;
      } catch (err) {
        this.logger.error(
          `pg-boss throttler cleanup scheduling failed; falling back to setInterval: ${err}`,
        );
      }
    }
    // Single-replica fallback: bare setInterval — behaviour identical
    // to pre-issue-#127 code. Tests take this path because they don't
    // bring up pg-boss.
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), THROTTLER_CLEANUP_INTERVAL_MS);
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
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.bossActive = false;
  }

  /** Test hook — surfaces which mode the lifecycle picked. */
  isPgBossActive(): boolean {
    return this.bossActive;
  }
}
