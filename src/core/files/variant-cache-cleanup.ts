import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import type { VariantCacheIndex } from "./variant-cache-index.js";

/**
 * VariantCacheCleanupCron — periodic prune of orphan variant rows
 * (CF.STORAGE.01 follow-up — iter-184).
 *
 * Iter-183 added the variant-cache index. Every cache miss writes a
 * row; rows are dropped only on explicit `removeBySourceKey`
 * cascade. Under sustained traffic the index grows monotonically
 * while the matching cache bytes may already be storage-evicted
 * (TTL/LRU on S3 / RustFS / local FS) — orphan rows. This cron
 * mirrors `IdempotencyCleanupCron` + `GeocodingCacheCleanupCron`:
 * 24h tick, default 90-day retention, calls `deleteOlderThan` on
 * the bound index.
 *
 * Adapters that don't expose `deleteOlderThan` (legacy seam) fall
 * back to log-only via duck-typing — same shape as the sibling
 * crons. Per-tick errors are caught + reported as
 * `{ deleted: null }` so a transient DB outage cannot crash-loop
 * the process.
 */

export const VARIANT_CACHE_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
export const DEFAULT_VARIANT_CACHE_RETENTION_DAYS = 90;

interface CleanupCapableIndex {
  deleteOlderThan(cutoffMs: number): Promise<number>;
}

function isCleanupCapable(index: unknown): index is CleanupCapableIndex {
  return (
    typeof index === "object" &&
    index !== null &&
    typeof (index as { deleteOlderThan?: unknown }).deleteOlderThan === "function"
  );
}

@Injectable()
export class VariantCacheCleanupCron implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("VariantCacheCleanup");
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(Symbol.for("lt:VariantCacheIndex")) private readonly index: VariantCacheIndex,
  ) {}

  onModuleInit(): void {
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), VARIANT_CACHE_CLEANUP_INTERVAL_MS);
  }

  /** Public so tests can call it deterministically. */
  async runOnce(): Promise<{ cutoffMs: number; deleted: number | null }> {
    const cutoffMs = Date.now() - DEFAULT_VARIANT_CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (!isCleanupCapable(this.index)) {
      this.logger.log(
        `cleanup-plan: cutoffMs=${cutoffMs} (index has no deleteOlderThan; logging only)`,
      );
      return { cutoffMs, deleted: null };
    }
    try {
      const deleted = await this.index.deleteOlderThan(cutoffMs);
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
