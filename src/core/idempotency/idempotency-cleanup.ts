import {
  Inject,
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
 * Multi-replica safety: use a distributed job scheduler (e.g. BullMQ
 * repeatable jobs) when deploying across multiple replicas. The bare
 * setInterval here is the single-process path which is correct for
 * the default single-container deployment.
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
  private wire?: WireCleanupRepeatResult;

  constructor(
    @Inject(Symbol.for("lt:IdempotencyStore")) private readonly store: IdempotencyStore,
    @Optional() private readonly jobQueue?: JobQueueService,
  ) {}

  async onModuleInit(): Promise<void> {
    void this.runOnce();
    this.wire = await wireBullMQCleanupRepeat(
      this.jobQueue,
      "idempotency",
      () => {
        void this.runOnce();
      },
      IDEMPOTENCY_CLEANUP_INTERVAL_MS,
    );
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
    this.wire?.stop?.();
    this.wire = undefined;
  }
}
