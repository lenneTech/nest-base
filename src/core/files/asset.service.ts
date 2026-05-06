import { createHash } from "node:crypto";

import type { StorageAdapter } from "./storage-adapter.js";
import type { VariantCacheIndex } from "./variant-cache-index.js";

/**
 * Asset transform + cache service.
 *
 * Pipeline per request:
 *   1. compute deterministic cache key from (key, options)
 *   2. read-through the cache adapter — return immediately on hit
 *   3. fetch original from the origin adapter
 *   4. run the transformer (IPX-routed in production)
 *   5. write the result to the cache adapter
 *   6. return bytes + mimeType
 *
 * The transformer interface is injectable so the unit suite skips
 * the heavy IPX runtime; the production binding (`IpxAssetTransformer`,
 * wired in `files.module.ts`) routes through `createIPX()` so inline
 * transforms share the same engine as the URL-mounted `/_ipx/*` endpoint.
 */

export interface TransformOptions {
  width?: number;
  height?: number;
  format?: "webp" | "jpeg" | "png" | "avif";
  quality?: number;
  fit?: "cover" | "contain" | "inside" | "outside";
}

export interface AssetTransformer {
  transform(
    bytes: Uint8Array,
    options: TransformOptions,
  ): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

export interface AssetServiceOptions {
  origin: StorageAdapter;
  cache: StorageAdapter;
  transformer: AssetTransformer;
  /**
   * Optional discoverable index over the variant cache (iter-183 —
   * CF.STORAGE.01 final closure). When present, every cache miss
   * that produces a fresh transform records `(cacheKey, sourceKey,
   * optionsHash, mimeType, sizeBytes)` so `invalidateSource` can
   * cascade-drop every variant for a source in O(log N) instead of
   * walking the entire `assets/*` prefix.
   */
  variantIndex?: VariantCacheIndex;
}

export interface AssetDeliveryResult {
  bytes: Uint8Array;
  mimeType: string;
}

const CACHE_PREFIX = "assets/";

export function computeCacheKey(originalKey: string, options: TransformOptions): string {
  const stable = stableStringify({ key: originalKey, options });
  const digest = createHash("sha256").update(stable).digest("hex").slice(0, 32);
  return `${CACHE_PREFIX}${digest}`;
}

/**
 * Stable hash of just the `TransformOptions` — used by the variant
 * cache index for analytics + dedup when two sources share the same
 * transform recipe.
 */
export function computeOptionsHash(options: TransformOptions): string {
  const stable = stableStringify(options);
  return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function isPassthrough(options: TransformOptions): boolean {
  for (const value of Object.values(options)) {
    if (value !== undefined) return false;
  }
  return true;
}

export class AssetService {
  private readonly origin: StorageAdapter;
  private readonly _cache: StorageAdapter;
  private readonly transformer: AssetTransformer;
  private readonly variantIndex?: VariantCacheIndex;

  constructor(options: AssetServiceOptions) {
    this.origin = options.origin;
    this._cache = options.cache;
    this.transformer = options.transformer;
    if (options.variantIndex !== undefined) this.variantIndex = options.variantIndex;
  }

  /**
   * Read-only access to the cache adapter so the controller can probe
   * `x-cache: HIT|MISS` headers without going through `deliver()`.
   */
  get cache(): StorageAdapter {
    return this._cache;
  }

  async deliver(key: string, options: TransformOptions): Promise<AssetDeliveryResult> {
    if (isPassthrough(options)) {
      // No transform requested — return the origin bytes directly.
      const bytes = await this.origin.get(key);
      return { bytes, mimeType: "application/octet-stream" };
    }

    const cacheKey = computeCacheKey(key, options);
    if (await this.cache.exists(cacheKey)) {
      const bytes = await this.cache.get(cacheKey);
      return { bytes, mimeType: mimeTypeForOptions(options) };
    }

    const original = await this.origin.get(key);
    const result = await this.transformer.transform(original, options);
    await this.cache.put({ key: cacheKey, body: result.bytes, mimeType: result.mimeType });
    if (this.variantIndex) {
      await this.variantIndex.record({
        cacheKey,
        sourceKey: key,
        optionsHash: computeOptionsHash(options),
        mimeType: result.mimeType,
        sizeBytes: result.bytes.byteLength,
        createdAt: new Date(),
      });
    }
    return result;
  }

  /**
   * Cascade-invalidate every cached variant of a source. When the
   * variant index is bound, this is O(log N) — the index returns the
   * cacheKeys, the storage adapter drops the bytes, the index drops
   * the rows. Without an index the AssetService can only invalidate
   * a known (sourceKey, options) pair via the legacy
   * `cache.delete(computeCacheKey(...))` path; this is the upgrade.
   *
   * Returns the count of variants dropped. Idempotent — calling on
   * a source with no live variants returns 0 without erroring.
   */
  async invalidateSource(sourceKey: string): Promise<number> {
    if (!this.variantIndex) return 0;
    const cacheKeys = await this.variantIndex.removeBySourceKey(sourceKey);
    for (const cacheKey of cacheKeys) {
      // Best-effort — a cache key already evicted by storage TTL is
      // not an error, the cascade just continues.
      try {
        await this.cache.delete(cacheKey);
      } catch {
        // Storage already pruned it — index row is gone, that's
        // sufficient for the cascade to be observable.
      }
    }
    return cacheKeys.length;
  }
}

function mimeTypeForOptions(options: TransformOptions): string {
  switch (options.format) {
    case "webp":
      return "image/webp";
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}
