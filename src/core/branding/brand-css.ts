/**
 * Brand → CSS-vars generator (pure planner).
 *
 * Produces a `:root { ... }` block that overrides the design-token
 * variables defined in the static `tokens.css`. The dev-portal SPA
 * shell injects this output as a `<style>` block in the document
 * `<head>` so the runtime brand wins over the build-time tokens.
 *
 * Two safety guarantees:
 *
 *   1. Determinism — no `Date.now()`, no `Math.random()`. Identical
 *      brand → byte-identical output. Lets the dev-runner cache by
 *      hash and lets snapshot tests stay tight.
 *
 *   2. CSS-injection safety — every value flows through
 *      `escapeCssValue()` which strips `<`, `>`, `;`, `(`, `)`,
 *      `\\`. Hex colors are already schema-validated, but defense in
 *      depth: a future field (e.g. `customCss`) added in haste must
 *      not be able to close the surrounding `<style>` block.
 */
import type { BrandConfig } from "./brand-schema.js";

export interface RenderBrandCssOptions {
  /**
   * Wrap the generated CSS in a `<style>` element so it can be
   * inlined into an HTML shell verbatim. Defaults to "none" (raw CSS
   * suitable for a standalone `*.css` response).
   */
  wrap?: "style" | "none";
}

/**
 * Strip characters that would break out of a CSS value or close the
 * surrounding `<style>` block.
 *
 * The whitelist of preserved characters covers everything we expect
 * in brand fields (hex colors, names, taglines): alphanumerics,
 * dashes, dots, `#`, spaces. Anything else is dropped — there's no
 * legitimate need to embed `<`, `>`, `;`, parens, or backslashes in
 * a brand-string surfaced in CSS.
 */
export function escapeCssValue(input: string): string {
  // Keep: a-z A-Z 0-9 # - . _ space comma percent
  // Drop: : ; < > ( ) \ ' " { } / * and everything else.
  // `:` is removed (NIT-1) — it is not needed for valid CSS color or
  // font-size values and could be misused to inject CSS property
  // separators (e.g. `color: red; background: url(...)`).
  return input.replace(/[^a-zA-Z0-9#\-._,% ]/g, "");
}

export function renderBrandCss(brand: BrandConfig, options: RenderBrandCssOptions = {}): string {
  const wrap = options.wrap ?? "none";

  // Hex → rgba converters reused for accent-soft / accent-glow. Schema
  // already enforced 6-digit hex so the parse is total here.
  const accent = brand.primaryColor;
  const { r, g, b } = parseHex(accent);
  const accentSoft = `rgba(${r}, ${g}, ${b}, 0.12)`;
  const accentGlow = `rgba(${r}, ${g}, ${b}, 0.35)`;
  const lineAccent = `rgba(${r}, ${g}, ${b}, 0.45)`;

  const safeName = escapeCssValue(brand.name);

  const css = `/* brand: ${safeName} — generated, do not edit */
:root {
  --accent: ${escapeCssValue(brand.primaryColor)};
  --accent-ink: ${escapeCssValue(brand.primaryColorInk)};
  --accent-soft: ${accentSoft};
  --accent-glow: ${accentGlow};
  --line-accent: ${lineAccent};
  --bg: ${escapeCssValue(brand.backgroundColor)};
  --surface-1: ${escapeCssValue(brand.surfaceColor)};
  --fg: ${escapeCssValue(brand.textColor)};
  --fg-dim: ${escapeCssValue(brand.mutedTextColor)};
}
`;
  if (wrap === "style") {
    return `<style>${css}</style>`;
  }
  return css;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): RGB {
  // Schema already enforces #RRGGBB; we just slice + parseInt.
  const clean = hex.startsWith("#") ? hex.slice(1) : hex;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}
