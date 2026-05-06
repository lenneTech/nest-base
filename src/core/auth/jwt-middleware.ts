/**
 * JWT-middleware path classification.
 *
 * Allowlist-driven: by default every API path requires a valid session
 * or scoped API key. The `PUBLIC_PREFIXES` set is the only escape hatch
 * — it covers diagnostics, the Better-Auth handler, and the docs UI.
 */

/**
 * Public paths — no JWT required.
 *
 * `/errors` is the public error-code catalogue — frontends + SDK
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
  "/dev/",
  "/errors/",
  "/api/openapi",
  // HMAC-signed share links — the token is the auth.
  "/files/share/",
];
const PUBLIC_EXACT = new Set(["/", "/errors", "/api/openapi", "/api-docs-json"]);

export function isPathProtected(path: string): boolean {
  if (!path) throw new Error("isPathProtected: path is required");
  if (PUBLIC_EXACT.has(path)) return false;
  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix) || path === prefix.slice(0, -1)) return false;
  }
  return true;
}
