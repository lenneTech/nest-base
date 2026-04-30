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
 * Inline style: a tiny `<style>` block sets `body { background: #020203 }`
 * so the page never flashes white before the bundle hydrates. The full
 * token set lives in `tokens.css` (built next to the bundle).
 *
 * Test coverage: see `tests/stories/dev-portal-shell.story.test.ts`.
 */

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
}

export interface DevPortalShellInputOverrides {
  title?: string;
  scriptUrl?: string;
  tokenCssUrl?: string;
  extraStylesheetUrls?: readonly string[];
}

const DEFAULT_TITLE = "Dev Portal";
const DEFAULT_SCRIPT_URL = "/dev/static/main.js";
const DEFAULT_TOKEN_CSS_URL = "/dev/static/tokens.css";
const DEFAULT_EXTRA_STYLESHEETS: readonly string[] = ["/dev/static/main.css"];

/**
 * Build a `DevPortalShellInput` with sensible defaults. Tests, the
 * controller, and the build step all read from the same single source
 * — keeping the SPA's static-asset paths defined in exactly one place.
 */
export function buildDevPortalShellInput(
  overrides: DevPortalShellInputOverrides,
): DevPortalShellInput {
  return {
    title: overrides.title ?? DEFAULT_TITLE,
    scriptUrl: overrides.scriptUrl ?? DEFAULT_SCRIPT_URL,
    tokenCssUrl: overrides.tokenCssUrl ?? DEFAULT_TOKEN_CSS_URL,
    extraStylesheetUrls: overrides.extraStylesheetUrls ?? DEFAULT_EXTRA_STYLESHEETS,
  };
}

export function renderDevPortalShell(input: DevPortalShellInput): string {
  const title = escapeHtml(input.title);
  const scriptUrl = escapeHtml(input.scriptUrl);
  const tokenCssUrl = escapeHtml(input.tokenCssUrl);
  const extras = (input.extraStylesheetUrls ?? [])
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join("\n");

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${title} — nest-server</title>
<link rel="preconnect" href="https://rsms.me/">
<link rel="stylesheet" href="https://rsms.me/inter/inter.css">
<link rel="stylesheet" href="${tokenCssUrl}">
${extras}
<style>html,body{margin:0;padding:0}body{background:#020203;color:#ffffff;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,system-ui,sans-serif}</style>
</head>
<body>
<div id="root"></div>
<noscript>This page requires JavaScript. The Dev Portal is a developer-only single-page app and ships only in NODE_ENV=development.</noscript>
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
