import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { buildCleanupJobPlan } from "../jobs/cleanup-job-planner.js";
import type { PgBossLike } from "../jobs/scheduled-job-pgboss-scheduler.js";
import type { IdempotencyRecord, IdempotencyStore } from "./idempotency.service.js";

/**
 * IdempotencyCleanupCron — periodic prune of expired idempotency
 * records (CF.STORAGE.01 follow-up — iter-181).
 *
 * Iter-179 added the Prisma adapter + `expiresAt` index on
 * `idempotency_records`. Iter-181 adds the periodic runner: every
 * 24h (and once on cold-boot), the cron asks the bound store to
 * delete every row whose `expiresAt < Date.now()`.
 *
 * Records past their expiresAt are already treated as cache misses
 * by the service layer (`IdempotencyService.runOrCache` re-runs the
 * handler when `existing.expiresAt <= now`), so retaining them is
 * dead weight that grows unbounded under sustained load. The
 * `expiresAt` index makes the prune O(log N).
 *
 * The runner duck-types `deleteOlderThan` on the bound store: when
 * the method is absent (e.g. a project replaces the binding with a
 * minimal in-memory fake during tests), the cron logs and reports
 * `{ deleted: null }` instead of throwing. Errors from the method
 * itself (DB outage etc.) are caught and surfaced as the same
 * `{ deleted: null }` shape so observability has a single signal.
 *
 * Multi-replica safety (issue #127 Finding 1): when a `PgBossLike`
 * adapter is injected, the cron registers itself as a pg-boss
 * scheduled job so only one replica runs the cleanup per tick.
 */

export const IDEMPOTENCY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

export interface CleanupCapableStore {
  deleteOlderThan(cutoffMs: number): Promise<number>;
}

export function isCleanupCapable(store: unknown): store is CleanupCapableStore {
  return (
    typeof store === "object" &&
    store !== null &&
    typeof (store as { deleteOlderThan?: unknown }).deleteOlderThan === "function"
  );
}

/**
 * In-memory adapter that implements both `IdempotencyStore` and
 * `CleanupCapableStore`. Production binds `PrismaIdempotencyStore`
 * (which carries its own `deleteOlderThan` against a real
 * `deleteMany`); this class is the test substrate AND the runtime
 * fallback when the Prisma client lacks the `idempotencyRecord`
 * delegate.
 */
export class InMemoryIdempotencyStoreWithCleanup implements IdempotencyStore, CleanupCapableStore {
  private readonly map = new Map<string, IdempotencyRecord>();

  async get(key: string): Promise<IdempotencyRecord | null> {
    return this.map.get(key) ?? null;
  }

  async put(record: IdempotencyRecord): Promise<void> {
    this.map.set(record.key, record);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async deleteOlderThan(cutoffMs: number): Promise<number> {
    let deleted = 0;
    for (const [key, record] of this.map) {
      if (record.expiresAt < cutoffMs) {
        this.map.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  /** Test-only — returns the live row count for assertions. */
  size(): number {
    return this.map.size;
  }
}

@Injectable()
export class IdempotencyCleanupCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("IdempotencyCleanup");
  private timer?: ReturnType<typeof setInterval>;
  private bossActive = false;

  constructor(
    @Inject(Symbol.for("lt:IdempotencyStore")) private readonly store: IdempotencyStore,
    @Optional() private readonly boss: PgBossLike | null = null,
  ) {}

  async onModuleInit(): Promise<void> {
    // Multi-replica path: delegate to pg-boss so only one replica
    // runs the cleanup per scheduled slot (issue #127 Finding 1).
    if (this.boss) {
      const plan = buildCleanupJobPlan({ kind: "idempotency" });
      try {
        await this.boss.work(plan.queueName, () => this.runOnce());
        await this.boss.schedule(plan.queueName, plan.cron);
        this.bossActive = true;
        this.logger.log(
          `idempotency cleanup scheduled via pg-boss (queue="${plan.queueName}", cron="${plan.cron}")`,
        );
        return;
      } catch (err) {
        this.logger.error(
          `pg-boss idempotency cleanup scheduling failed; falling back to setInterval: ${err}`,
        );
      }
    }
    // Single-replica fallback: bare setInterval keeps the process
    // alive — fine for a long-running server, irrelevant for tests
    // (Vitest tears down before the first tick fires).
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), IDEMPOTENCY_CLEANUP_INTERVAL_MS);
  }

  /** Public so tests can call it deterministically. */
  async runOnce(): Promise<{ cutoffMs: number; deleted: number | null }> {
    const cutoffMs = Date.now();
    if (!isCleanupCapable(this.store)) {
      this.logger.log(
        `cleanup-plan: cutoffMs=${cutoffMs} (store has no deleteOlderThan; logging only)`,
      );
      return { cutoffMs, deleted: null };
    }
    try {
      const deleted = await this.store.deleteOlderThan(cutoffMs);
      this.logger.log(`cleanup-run: cutoffMs=${cutoffMs} deleted=${deleted}`);
      return { cutoffMs, deleted };
    } catch (err) {
      // The cron must NEVER take the process down — a transient DB
      // outage would otherwise crash-loop on every tick. Report null
      // so observability matches the legacy-adapter case.
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
