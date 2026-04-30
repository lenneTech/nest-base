/**
 * Brand-Loader — reads `brand.json` from disk and materialises a
 * validated `BrandConfig`.
 *
 * Lookup precedence:
 *   1. project overlay  → `src/modules/branding/brand.json` (committed
 *                          in the consumer repo, never touched by sync)
 *   2. template default → `src/core/branding/brand.default.json`
 *                          (template-owned, syncs upstream)
 *   3. schema built-ins → emergency fallback so first-boot never crashes
 *
 * The runner caches by project root; the dev-runner clears the cache
 * via `__clearBrandCache()` whenever `brand.json` changes (analogous
 * to the `.env` watcher) so hot-reload Just Works.
 *
 * The pure planner half (`planBrandLoad`) takes parsed-JSON inputs and
 * returns the merged config — fully testable without I/O.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BrandConfigSchema,
  type BrandConfig,
  type BrandConfigInput,
  decodeBrand,
} from "./brand-schema.js";

export interface BrandLoadInput {
  /** Parsed project overlay (or null when the file does not exist). */
  overlay: BrandConfigInput | null;
  /** Parsed template default (or null when the file does not exist). */
  defaultJson: BrandConfigInput | null;
}

export interface BrandLoadResult {
  brand: BrandConfig;
  /** Where the effective brand came from — diagnostics-friendly. */
  source: "overlay" | "default" | "builtin";
}

/**
 * Pure planner — picks which input wins and validates it.
 *
 * The merge is "first-wins" (overlay or default), not a deep object
 * merge. Brand JSONs are tiny and authored end-to-end; partial
 * overlays would muddle the auditing story (a `git diff` on
 * `brand.json` should say "this is the brand" without the reader
 * having to mentally combine two files).
 *
 * If the caller wants partial overrides during testing, they pass an
 * already-merged shape as the overlay.
 */
export function planBrandLoad(input: BrandLoadInput): BrandLoadResult {
  if (input.overlay !== null) {
    return { brand: decodeBrand(input.overlay), source: "overlay" };
  }
  if (input.defaultJson !== null) {
    return { brand: decodeBrand(input.defaultJson), source: "default" };
  }
  // Worst-case fallback — schema parses an empty object only when the
  // required `name` field is supplied. We seed the same nest-base
  // identity the bundled `brand.default.json` carries so first-boot
  // before any JSON exists still renders the dev-portal coherently.
  return {
    brand: BrandConfigSchema.parse({ name: "nest-base" }),
    source: "builtin",
  };
}

export interface BrandPaths {
  overlayPath: string;
  defaultPath: string;
}

/**
 * Computes the canonical paths for the two brand-config files
 * relative to a project root. Pure helper — used by both the runner
 * and the dev-runner watcher.
 */
export function resolveBrandPaths(root: string): BrandPaths {
  return {
    overlayPath: resolve(root, "src/modules/branding/brand.json"),
    defaultPath: resolve(root, "src/core/branding/brand.default.json"),
  };
}

interface CacheEntry {
  root: string;
  brand: BrandConfig;
}

let cached: CacheEntry | null = null;

/**
 * Synchronous brand loader. Cached by project root.
 *
 * Sync is intentional — every consumer (CSS-var generator, OpenAPI
 * builder, EmailModule) reads the brand once at module-resolve /
 * boot time and keeps the value. Async I/O here would push the
 * complexity into ten unrelated callsites for zero throughput gain.
 */
export function loadBrandSync(projectRoot: string = process.cwd()): BrandConfig {
  if (cached && cached.root === projectRoot) {
    return cached.brand;
  }
  const paths = resolveBrandPaths(projectRoot);
  const overlay = readJsonOrNull(paths.overlayPath);
  const defaultJson = readJsonOrNull(paths.defaultPath);
  const result = planBrandLoad({ overlay, defaultJson });
  cached = { root: projectRoot, brand: result.brand };
  return result.brand;
}

/**
 * Drops the cached value so the next `loadBrandSync()` re-reads the
 * JSON files. Used by:
 *   - tests (per-it isolation)
 *   - the dev runner's `brand.json` watcher (issue #5 hot-reload)
 */
export function __clearBrandCache(): void {
  cached = null;
}

function readJsonOrNull(path: string): BrandConfigInput | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`brand-loader: failed to read ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(raw) as BrandConfigInput;
  } catch (err) {
    throw new Error(`brand-loader: ${path} contains invalid JSON: ${(err as Error).message}`);
  }
}
