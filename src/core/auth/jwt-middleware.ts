/**
 * JWT-middleware path classification.
 *
 * Allowlist-driven: by default every API path requires a valid session
 * or scoped API key. The `PUBLIC_PREFIXES` set is the only escape hatch
 * — it covers diagnostics, the Better-Auth handler, and the docs UI.
 *
 * Issue #83: all API routes are now under `/api/*`. Paths that remain
 * at root level are: Hub (`/`, `/hub/*`), health (`/health/*`), and
 * the legacy `/api-docs-json` alias. All `/dev/*` and `/admin/*` paths
 * are now under `/api/hub/*` and `/api/admin/*`.
 */

/**
 * Public paths — no JWT required.
 *
 * `/api/errors` is the public error-code catalogue — frontends + SDK
 * generators consume it without authenticating. `/api/openapi` and
 * `/api/openapi.json` serve the OpenAPI spec the SDK generators read.
 * Both are dev-friendly (they expose error codes / route shapes only,
 * never user data) and intentionally outside the auth wall.
 *
 * `/api-docs-json` is the deprecated legacy alias for the OpenAPI
 * doc, kept exempt for the same reason as `/api/openapi.json` until
 * the upstream `nuxt-base-starter` fix
 * (lenneTech/nuxt-base-starter#13) has propagated.
 */
const PUBLIC_PREFIXES = [
  "/health/",
  "/api/auth/",
  "/docs/",
  "/api/hub/",
  "/api/admin/",
  "/api/errors/",
  "/api/openapi",
  // HMAC-signed share links — the token is the auth.
  "/api/files/share/",
  // Hub SPA routes (login/logout) are public.
  "/hub/",
];
const PUBLIC_EXACT = new Set([
  "/",
  // API identity endpoint (AppController @Get() under the global /api/ prefix).
  "/api/",
  "/api",
  "/api/errors",
  "/api/openapi",
  "/api-docs-json",
  "/hub/login",
  "/hub/logout",
]);

export function isPathProtected(path: string): boolean {
  if (!path) throw new Error("isPathProtected: path is required");
  if (PUBLIC_EXACT.has(path)) return false;
  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix) || path === prefix.slice(0, -1)) return false;
  }
  return true;
}
