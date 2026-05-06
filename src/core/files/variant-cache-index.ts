/**
 * VariantCacheIndex — discoverable index over the asset variant cache
 * (CF.STORAGE.01 closure — iter-183).
 *
 * `AssetService` already content-addresses transform variants via
 * `computeCacheKey({sourceKey, options}) → "assets/<sha256>"` and
 * stores the rendered bytes on a `StorageAdapter`. The cache STORAGE
 * alone can answer "does cache key `assets/<X>` exist" but cannot
 * answer "list every variant for source `images/foo.png`" without
 * walking the entire `assets/` prefix.
 *
 * That gap matters for invalidation: when the origin re-uploads
 * `images/foo.png`, every cached variant becomes stale, but the
 * AssetService has no way to enumerate them. Today the only
 * invalidation surface is `DELETE /_ipx/cache/<sourcePath>` which
 * relies on hashes the caller already knows.
 *
 * This index closes the loop:
 *   - On cache miss, AssetService records the variant in the index
 *     (cacheKey + sourceKey + optionsHash + mimeType + sizeBytes).
 *   - `invalidateSource(sourceKey)` queries the index for every
 *     cacheKey under the source, removes them from both the storage
 *     adapter AND the index, and returns the cascade count.
 *   - `getStats()` powers admin dashboards (variant count + total
 *     bytes occupied across the cache).
 *
 * Two adapters ship: `InMemoryVariantCacheIndex` (this file) is the
 * test default and the runtime fallback when the Prisma client lacks
 * the `assetVariantIndex` delegate; `PrismaVariantCacheIndex` (in
 * `variant-cache-index.prisma.ts`) is the production binding.
 */

export interface VariantCacheEntry {
  /** Stable hash of `(sourceKey, options)` — same value `computeCacheKey` returns. */
  cacheKey: string;
  /** The source object the variant was rendered from (e.g. `images/foo.png`). */
  sourceKey: string;
  /** Stable hash of just the `TransformOptions` — useful for analytics + dedup. */
  optionsHash: string;
  /** MIME type of the rendered variant. */
  mimeType: string;
  /** Byte size of the rendered variant — drives total-bytes stats + LRU eviction. */
  sizeBytes: number;
  /** When the variant was first recorded in the index. */
  createdAt: Date;
}

export interface VariantCacheIndexStats {
  entryCount: number;
  totalBytes: number;
}

export interface VariantCacheIndex {
  /**
   * Insert or replace a variant entry. Idempotent on `cacheKey` —
   * a re-transform with the same options produces the same cacheKey
   * and refreshes the row's `sizeBytes` / `createdAt`.
   */
  record(entry: VariantCacheEntry): Promise<void>;

  /**
   * Return every variant currently indexed against a source. Empty
   * array on unknown sources.
   */
  listBySourceKey(sourceKey: string): Promise<VariantCacheEntry[]>;

  /**
   * Remove a single variant by its cacheKey. Returns `true` on a
   * deletion, `false` when the row was already gone (best-effort
   * cleanup — concurrent invalidation tick may have raced ahead).
   */
  removeByCacheKey(cacheKey: string): Promise<boolean>;

  /**
   * Cascade-remove every variant for a source. Returns the list of
   * cacheKeys that were dropped — the caller (AssetService) uses
   * this to drop the matching bytes from the storage adapter.
   * Empty array when no rows matched (idempotent invalidation).
   */
  removeBySourceKey(sourceKey: string): Promise<string[]>;

  /**
   * Index-wide stats. Powers admin/dev observability dashboards.
   */
  getStats(): Promise<VariantCacheIndexStats>;

  /**
   * Cleanup-cron entry point: delete every row whose `createdAt`
   * is older than `cutoffMs`. The `VariantCacheCleanupCron` calls
   * this on a 24h tick to prevent unbounded row growth — entries
   * past their retention window may have already been evicted from
   * the storage adapter (TTL/LRU), so the index row would otherwise
   * orphan. Returns the count of rows pruned. Optional on the
   * interface so legacy seams can opt out via duck-typing detection
   * in the cron — same contract as `IdempotencyStore.deleteOlderThan`.
   */
  deleteOlderThan?(cutoffMs: number): Promise<number>;
}

/**
 * In-memory adapter — test default + runtime fallback when Prisma's
 * `assetVariantIndex` delegate is missing. Defensive copy on read so
 * callers can mutate the returned entries without corrupting state.
 */
export class InMemoryVariantCacheIndex implements VariantCacheIndex {
  private readonly byCacheKey = new Map<string, VariantCacheEntry>();

  async record(entry: VariantCacheEntry): Promise<void> {
    this.byCacheKey.set(entry.cacheKey, this.copy(entry));
  }

  async listBySourceKey(sourceKey: string): Promise<VariantCacheEntry[]> {
    const out: VariantCacheEntry[] = [];
    for (const entry of this.byCacheKey.values()) {
      if (entry.sourceKey === sourceKey) out.push(this.copy(entry));
    }
    return out;
  }

  async removeByCacheKey(cacheKey: string): Promise<boolean> {
    return this.byCacheKey.delete(cacheKey);
  }

  async removeBySourceKey(sourceKey: string): Promise<string[]> {
    const cascade: string[] = [];
    for (const [key, entry] of this.byCacheKey) {
      if (entry.sourceKey === sourceKey) {
        cascade.push(key);
        this.byCacheKey.delete(key);
      }
    }
    return cascade;
  }

  async getStats(): Promise<VariantCacheIndexStats> {
    let totalBytes = 0;
    for (const entry of this.byCacheKey.values()) {
      totalBytes += entry.sizeBytes;
    }
    return { entryCount: this.byCacheKey.size, totalBytes };
  }

  async deleteOlderThan(cutoffMs: number): Promise<number> {
    let deleted = 0;
    for (const [key, entry] of this.byCacheKey) {
      if (entry.createdAt.getTime() < cutoffMs) {
        this.byCacheKey.delete(key);
        deleted += 1;
      }
    }
    return deleted;
  }

  /** Test-only — returns the live row count. */
  size(): number {
    return this.byCacheKey.size;
  }

  private copy(entry: VariantCacheEntry): VariantCacheEntry {
    return {
      cacheKey: entry.cacheKey,
      sourceKey: entry.sourceKey,
      optionsHash: entry.optionsHash,
      mimeType: entry.mimeType,
      sizeBytes: entry.sizeBytes,
      createdAt: new Date(entry.createdAt.getTime()),
    };
  }
}
