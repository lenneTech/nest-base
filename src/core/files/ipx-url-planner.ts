import type { AssetPresetRegistry } from "./asset-presets.js";

/**
 * IPX URL planner — pure functions that translate the legacy
 * `/assets/:key?width=…&format=…` query API to IPX's
 * `/_ipx/<modifiers>/<source>` URL syntax, and resolve named asset
 * presets to concrete IPX modifiers.
 *
 * IPX modifier syntax (from `createIPXH3Handler`):
 *   `<key>_<value>` separated by `,`
 *   `_` (single underscore) means "no modifiers"
 *   keys are short forms: w (width), h (height), q (quality),
 *   f (format), fit, blur, sharpen, …
 *
 * Defense-in-depth: this planner only forwards the documented
 * allow-list of legacy params; unknown / malformed inputs are
 * silently dropped so the IPX layer never sees attacker-controlled
 * modifier strings beyond what the controller intends.
 */

const ALLOWED_FORMATS = new Set(["webp", "jpeg", "png", "avif"]);
const ALLOWED_FIT = new Set(["cover", "contain", "inside", "outside"]);

/**
 * Translate a legacy `/assets/:key?…` query map into IPX modifiers.
 *
 * Empty / invalid inputs result in an empty object (passthrough).
 * Unknown query keys are dropped — only the documented allow-list
 * (`width`, `height`, `format`, `quality`, `fit`) is forwarded.
 */
export function legacyQueryToIpxModifiers(
  query: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};

  const width = parsePositiveInt(query.width);
  if (width !== undefined) out.w = String(width);

  const height = parsePositiveInt(query.height);
  if (height !== undefined) out.h = String(height);

  const quality = parseQuality(query.quality);
  if (quality !== undefined) out.q = String(quality);

  if (query.format && ALLOWED_FORMATS.has(query.format)) {
    out.f = query.format;
  }

  if (query.fit && ALLOWED_FIT.has(query.fit)) {
    out.fit = query.fit;
  }

  return out;
}

/**
 * Build the IPX modifier-string segment of `/_ipx/<modifiers>/<source>`.
 *
 * Empty modifier object → `_` (IPX's "no transform" marker). Otherwise
 * `<key>_<value>` joined by `,`, with keys sorted for deterministic
 * URLs (CDN cache hits regardless of input ordering).
 */
export function buildIpxModifierString(modifiers: Record<string, string>): string {
  const entries = Object.entries(modifiers);
  if (entries.length === 0) return "_";
  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}_${v}`)
    .join(",");
}

/**
 * Resolve a named asset preset (e.g. `thumbnail`) into the matching
 * IPX modifier object via the project's `AssetPresetRegistry`.
 *
 * Throws when the preset name is unknown so the caller can return a
 * 404 / 400 to the client.
 */
export function resolvePresetModifiers(
  name: string,
  registry: AssetPresetRegistry,
): Record<string, string> {
  const preset = registry.get(name);
  const out: Record<string, string> = {};
  if (preset.width !== undefined) out.w = String(preset.width);
  if (preset.height !== undefined) out.h = String(preset.height);
  if (preset.format !== undefined) out.f = preset.format;
  if (preset.quality !== undefined) out.q = String(preset.quality);
  if (preset.fit !== undefined) out.fit = preset.fit;
  return out;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  // The legacy URL surface is permissive (any positive integer); we
  // bail on anything that doesn't parse cleanly so attackers can't
  // smuggle floats / negatives / NaN through.
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

function parseQuality(value: string | undefined): number | undefined {
  const n = parsePositiveInt(value);
  if (n === undefined) return undefined;
  if (n > 100) return undefined;
  return n;
}
