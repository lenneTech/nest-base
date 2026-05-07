/**
 * Dev-Portal Shell renderer (pure planner).
 *
 * Produces the static HTML skeleton that hosts the React SPA at every
 * `/dev/*` route reachable by the new client. The skeleton is deliberately
 * minimal — `<div id="root"></div>` plus the design-token stylesheet and
 * the bundled `main.js`. React-Router (`createBrowserRouter`) takes over
 * the navigation; the server only catches all `/dev/*` paths and returns
 * the same shell.
 *
 * Inputs are explicit and HTML-escaped: title, scriptUrl, tokenCssUrl. A
 * misconfigured controller cannot inject markup. The same five-character
 * escape table the rest of `src/core/dx/` uses is reused here.
 *
 * Inline style: a tiny `<style>` block sets the boot-time background +
 * brand identity so the page never flashes white before the bundle
 * hydrates. When a brand is supplied, the renderer also emits a
 * `<style>` block with the brand-derived `:root { --accent: …; … }`
 * overrides so the dev-portal picks up the runtime brand without a
 * round-trip to the JSON endpoint.
 *
 * The brand tuple `(brandName, brandCss)` is optional so the existing
 * test surface (which renders the shell without a brand) keeps
 * working: when omitted, the shell falls back to "nest-server" as the
 * title suffix and the static `tokens.css` colors.
 *
 * Test coverage: see `tests/stories/dev-portal-shell.story.test.ts`.
 */

import { loadBrandSync } from "../branding/brand-loader.js";
import { renderBrandCss } from "../branding/brand-css.js";

export interface DevPortalShellInput {
  /** Page <title> (escaped). Defaults to "Dev Portal" via `buildDevPortalShellInput`. */
  title: string;
  /** URL of the bundled main.js (escaped). Loaded as `type="module"`. */
  scriptUrl: string;
  /** URL of the tokens.css (escaped). Loaded as `<link rel="stylesheet">`. */
  tokenCssUrl: string;
  /**
   * Additional stylesheet URLs (escaped) emitted alongside the bundle.
   * Bun pulls every `import "./*.css"` out of `main.tsx` into a
   * sibling `main.css`; we list it here so the shell can load it
   * without parsing the bundle output. Optional.
   */
  extraStylesheetUrls?: readonly string[];
  /**
   * Brand name used as the title suffix (`<title>Foo — <brandName></title>`)
   * and as the boot-time background hint. Optional — defaults to
   * "nest-server" so the existing test surface stays backwards
   * compatible.
   */
  brandName?: string;
  /**
   * Pre-rendered CSS string emitted in a `<style>` block before the
   * static `tokens.css` so the brand-derived `:root { --accent: ...; }`
   * overrides win the cascade. Optional.
   */
  brandCss?: string;
  /** Boot-time background color (escaped). Defaults to `#020203`. */
  bootBackground?: string;
  /**
   * Brand JSON to expose as `window.__BRAND__` for the SPA. The
   * AdminShell reads it to render the sidebar brand name without a
   * round-trip. Optional — when omitted, the SPA falls back to
   * "nest-server".
   */
  brandJson?: string;
}

export interface DevPortalShellInputOverrides {
  title?: string;
  scriptUrl?: string;
  tokenCssUrl?: string;
  extraStylesheetUrls?: readonly string[];
  brandName?: string;
  brandCss?: string;
  bootBackground?: string;
  brandJson?: string;
}

const DEFAULT_TITLE = "Dev Portal";
// Hub static assets are served at /hub/static/* (no /api prefix — the
// hub controller is excluded from the global "api" prefix).
const DEFAULT_SCRIPT_URL = "/hub/static/main.js";
const DEFAULT_TOKEN_CSS_URL = "/hub/static/tokens.css";
const DEFAULT_EXTRA_STYLESHEETS: readonly string[] = ["/hub/static/main.css"];
const DEFAULT_BRAND_NAME = "nest-server";
const DEFAULT_BOOT_BACKGROUND = "#020203";

/**
 * Build a `DevPortalShellInput` with sensible defaults. Tests, the
 * controller, and the build step all read from the same single source
 * — keeping the SPA's static-asset paths defined in exactly one place.
 *
 * When `brand: "central"` is supplied, the helper walks the central
 * brand-loader to populate `brandName` + `brandCss` + `bootBackground`.
 * That's what controllers use: they don't pass an explicit brand, they
 * ask the helper to fetch it.
 */
export function buildDevPortalShellInput(
  overrides: DevPortalShellInputOverrides & { brand?: "central" } = {},
): DevPortalShellInput {
  let brandName = overrides.brandName;
  let brandCss = overrides.brandCss;
  let bootBackground = overrides.bootBackground;
  let brandJson = overrides.brandJson;
  if (overrides.brand === "central") {
    const brand = loadBrandSync();
    brandName ??= brand.name;
    brandCss ??= renderBrandCss(brand);
    bootBackground ??= brand.backgroundColor;
    // Strip CSS-only fields that would only inflate the inlined JSON;
    // the SPA needs name + shortName + tagline + colors for the
    // sidebar render. Hex values are schema-validated, so no
    // sanitisation needed beyond JSON.stringify (which already
    // escapes embedded quotes / backslashes).
    brandJson ??= JSON.stringify(brand);
  }
  const result: DevPortalShellInput = {
    title: overrides.title ?? DEFAULT_TITLE,
    scriptUrl: overrides.scriptUrl ?? DEFAULT_SCRIPT_URL,
    tokenCssUrl: overrides.tokenCssUrl ?? DEFAULT_TOKEN_CSS_URL,
    extraStylesheetUrls: overrides.extraStylesheetUrls ?? DEFAULT_EXTRA_STYLESHEETS,
  };
  if (brandName !== undefined) result.brandName = brandName;
  if (brandCss !== undefined) result.brandCss = brandCss;
  if (bootBackground !== undefined) result.bootBackground = bootBackground;
  if (brandJson !== undefined) result.brandJson = brandJson;
  return result;
}

export function renderDevPortalShell(input: DevPortalShellInput): string {
  const title = escapeHtml(input.title);
  const scriptUrl = escapeHtml(input.scriptUrl);
  const tokenCssUrl = escapeHtml(input.tokenCssUrl);
  const brandName = escapeHtml(input.brandName ?? DEFAULT_BRAND_NAME);
  const bootBackground = escapeHtml(input.bootBackground ?? DEFAULT_BOOT_BACKGROUND);
  const extras = (input.extraStylesheetUrls ?? [])
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join("\n");
  // Brand CSS lands AFTER the static tokens.css link so the brand-derived
  // `--accent`, `--bg`, `--surface-1`, … values override the build-time
  // defaults. The string is treated as already-CSS (renderBrandCss
  // sanitises every value internally via escapeCssValue).
  const brandStyle = input.brandCss ? `<style>${input.brandCss}</style>` : "";
  // Brand JSON injected as `window.__BRAND__` for the SPA. The JSON is
  // schema-validated (hex colors, email shape, URL shape) but free-text
  // fields like `name` could contain `</script>` substrings if a future
  // operator pastes raw HTML there. Escape the close-tag sentinel so
  // the surrounding <script> block can't be terminated prematurely.
  const brandScript = input.brandJson
    ? `<script>window.__BRAND__=${input.brandJson.replace(/<\/script/gi, "<\\/script")};</script>`
    : "";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title} — ${brandName}</title>
<link rel="preconnect" href="https://rsms.me/">
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
<link rel="stylesheet" href="${tokenCssUrl}">
${extras}
${brandStyle}
<style>html,body{margin:0;padding:0}body{background:${bootBackground};color:#ffffff;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,system-ui,sans-serif}</style>
${brandScript}
</head>
<body>
<div id="root"></div>
<noscript>This page requires JavaScript. The Hub is a single-page app.</noscript>
<script type="module" src="${scriptUrl}"></script>
</body>
</html>`;
}

/**
 * HTML-escape a fragment. Mirrors the standard table used across the
 * other dev/admin renderers. Five characters: & < > " '.
 */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
