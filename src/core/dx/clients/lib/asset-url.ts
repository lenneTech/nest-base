/**
 * Pure planner: build IPX-routed asset URLs for the dev-portal
 * File-Manager. Two surfaces map onto the same engine — the planner
 * keeps the contract documented + testable.
 *
 * - `/_ipx/<modifiers>/<source>` — Nuxt-Image-compatible. Used by
 *   the lightbox for full-resolution previews so the same cache
 *   slice every Nuxt-Image-aware client hits is reused.
 * - `/_ipx/_/<source>` — bare passthrough (`_` is the IPX no-op
 *   modifier set), used when the file's raw bytes are appropriate
 *   (e.g. application/pdf where IPX would otherwise refuse).
 */

export interface AssetUrlInput {
  storageKey: string;
  width?: number;
  height?: number;
  format?: "webp" | "avif" | "jpeg" | "png";
  fit?: "cover" | "contain" | "fill" | "inside" | "outside";
}

/**
 * Build an IPX URL. The storage key may already start with a slash —
 * we normalise to one leading slash so consumers can pass either
 * shape without cargo-culting the format.
 */
export function buildIpxUrl(input: AssetUrlInput): string {
  const modifiers: string[] = [];
  if (input.width !== undefined && input.width > 0) modifiers.push(`w_${input.width}`);
  if (input.height !== undefined && input.height > 0) modifiers.push(`h_${input.height}`);
  if (input.format) modifiers.push(`f_${input.format}`);
  if (input.fit) modifiers.push(`fit_${input.fit}`);
  const modifierString = modifiers.length > 0 ? modifiers.join(",") : "_";
  const source = input.storageKey.startsWith("/") ? input.storageKey.slice(1) : input.storageKey;
  return `/_ipx/${modifierString}/${source}`;
}

/**
 * True when a mime-type can be displayed inline via `<img>` — used
 * by the lightbox to decide between rendering a `<img>` tag or
 * falling back to a download link for non-previewable formats.
 */
export function isPreviewableImage(mimeType: string): boolean {
  if (!mimeType) return false;
  if (!mimeType.startsWith("image/")) return false;
  // SVG is risky (XSS via embedded scripts) and the dev-portal
  // doesn't sanitize. Skip until a SVG-safe pipeline lands.
  if (mimeType === "image/svg+xml") return false;
  return true;
}
