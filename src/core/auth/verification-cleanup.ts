import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";

/**
 * VerificationCleanupCron — periodic prune of stale Better-Auth
 * `Verification` rows (iter-193).
 *
 * Better-Auth issues one `verifications` row per email-verify /
 * password-reset / magic-link flow. The library does not auto-prune
 * the table — under sustained traffic it grows unbounded with stale
 * tokens. This cron mirrors `IdempotencyCleanupCron` +
 * `GeocodingCacheCleanupCron` + `VariantCacheCleanupCron`: every
 * 24h, prune rows whose `expiresAt < now - 7d` (default retention
 * keeps recently-expired rows for short-term operator debugging,
 * drops anything older than a week).
 *
 * Adapters that don't expose `deleteOlderThan` (legacy seam) fall
 * back to log-only via duck-typing — same shape as the sibling
 * crons. Per-tick errors are caught + reported as `{deleted: null}`
 * so a transient DB outage does not crash-loop the process via
 * `setInterval`'s `void this.runOnce()` callback.
 */

export const VERIFICATION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
export const DEFAULT_VERIFICATION_RETENTION_DAYS = 7;

export const VERIFICATION_STORE = Symbol.for("lt:VerificationStore");

export interface VerificationRecord {
  readonly id: string;
  readonly identifier: string;
  readonly expiresAt: number;
}

export interface VerificationStore {
  /** Test-only — append a record so cleanup paths can assert pruning. */
  put(record: VerificationRecord): Promise<void>;
  /** Test-only — count remaining rows for assertion. */
  size(): Promise<number>;
  /** Optional: cleanup-cron entry point. Adapters without it fall back to log-only. */
  deleteOlderThan?(cutoffMs: number): Promise<number>;
}

interface CleanupCapableStore {
  deleteOlderThan(cutoffMs: number): Promise<number>;
}

function isCleanupCapable(store: unknown): store is CleanupCapableStore {
  return (
    typeof store === "object" &&
    store !== null &&
    typeof (store as { deleteOlderThan?: unknown }).deleteOlderThan === "function"
  );
}

/**
 * In-memory adapter — test default. The production binding is the
 * `PrismaVerificationStore` below, factory-selected via
 * `hasPrismaVerificationDelegate(prisma)`.
 */
export class InMemoryVerificationStore implements VerificationStore {
  private readonly rows = new Map<string, VerificationRecord>();

  async put(record: VerificationRecord): Promise<void> {
    this.rows.set(record.id, record);
  }

  async size(): Promise<number> {
    return this.rows.size;
  }

  async deleteOlderThan(cutoffMs: number): Promise<number> {
    let deleted = 0;
    for (const [key, record] of this.rows) {
      if (record.expiresAt < cutoffMs) {
        this.rows.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }
}

/**
 * Prisma-backed adapter. Calls `prisma.verification.deleteMany` on
 * the rows whose `expiresAt < cutoffMs`. The matching
 * `@@index([expiresAt])` on `Verification` (migration
 * `20260506160000_verifications_expires_at`) makes the prune
 * O(log N) so the cost stays bounded as long-running deployments
 * accumulate verification rows.
 */
interface PrismaVerificationDelegate {
  deleteMany(input: { where: { expiresAt: { lt: Date } } }): Promise<{ count: number }>;
  count(): Promise<number>;
}

interface PrismaVerificationClient {
  verification: PrismaVerificationDelegate;
}

export class PrismaVerificationStore implements VerificationStore {
  constructor(private readonly prisma: PrismaService) {}

  async put(): Promise<void> {
    // Production rows come from Better-Auth's signup/reset flows;
    // the cleanup cron never inserts. Test-only stores do.
    throw new Error(
      "PrismaVerificationStore.put: not used in production (Better-Auth owns inserts)",
    );
  }

  async size(): Promise<number> {
    return await this.client().verification.count();
  }

  async deleteOlderThan(cutoffMs: number): Promise<number> {
    const result = await this.client().verification.deleteMany({
      where: { expiresAt: { lt: new Date(cutoffMs) } },
    });
    return result.count;
  }

  private client(): PrismaVerificationClient {
    const erased: unknown = this.prisma;
    return erased as PrismaVerificationClient;
  }
}

@Injectable()
export class VerificationCleanupCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("VerificationCleanup");
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(VERIFICATION_STORE) private readonly store: VerificationStore) {}

  onModuleInit(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), VERIFICATION_CLEANUP_INTERVAL_MS);
  }

  /** Public so tests can call it deterministically. */
  async runOnce(): Promise<{ cutoffMs: number; deleted: number | null }> {
    const cutoffMs = Date.now() - DEFAULT_VERIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
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
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`cleanup-error: cutoffMs=${cutoffMs} error="${msg}"`);
      return { cutoffMs, deleted: null };
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
