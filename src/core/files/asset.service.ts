import { createHash } from "node:crypto";

import type { StorageAdapter } from "./storage-adapter.js";

/**
 * Asset transform + cache service (PLAN.md §8 + §32 Phase 4).
 *
 * Pipeline per request:
 *   1. compute deterministic cache key from (key, options)
 *   2. read-through the cache adapter — return immediately on hit
 *   3. fetch original from the origin adapter
 *   4. run the transformer (`sharp` in production)
 *   5. write the result to the cache adapter
 *   6. return bytes + mimeType
 *
 * The transformer interface is injectable so the unit suite skips
 * the `sharp` native binding; the production binding (`SharpTransformer`,
 * lands when the file-module wires the NestJS provider) wraps the
 * real library with the same surface.
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
  private readonly cache: StorageAdapter;
  private readonly transformer: AssetTransformer;

  constructor(options: AssetServiceOptions) {
    this.origin = options.origin;
    this.cache = options.cache;
    this.transformer = options.transformer;
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
    return result;
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
