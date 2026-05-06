/**
 * Path-classification for the tenant-guard.
 *
 * Public/system paths (/, /health/*, /api/auth/*) are exempt from the
 * tenant-header requirement. Everything else needs the header to be
 * present and parseable as a UUID.
 *
 * The actual NestJS Guard wraps this classifier in a future slice.
 */

// `/api-docs-json` is the deprecated legacy alias for
// `/api/openapi.json` — exempt from the tenant header because SDK
// generators that hit the legacy URL don't carry a tenant context
// (mirrors the canonical doc's exemption). Removed once
// lenneTech/nuxt-base-starter#13 has propagated.
//
// Issue #83: all API routes are now under `/api/*`. Paths that remain
// at root level are: Hub (`/`, `/hub/*`) and health (`/health/*`).
// The domain paths below have been updated to include the `/api/` prefix.
const EXEMPT_EXACT = new Set([
  "/",
  // API identity endpoint (AppController at GET /api/ — no tenant context needed).
  "/api/",
  "/api",
  "/api/errors",
  "/api/tenants",
  "/api-docs-json",
  "/api/metrics",
]);
// `/api/me/*` endpoints operate on the authenticated user (req.user.id),
// not on a specific tenant. `/api/tenants` is the self-service tenant CRUD
// surface — a signed-up user creates their first tenant here, so the
// header cannot be required at the bootstrap step.
const EXEMPT_PREFIXES = [
  "/health/",
  "/api/auth/",
  "/docs/",
  "/api/dev/",
  "/api/admin/",
  "/api/errors/",
  "/api/me/",
  "/api/tenants/",
  // Share-token endpoints — the token's HMAC envelope encodes the
  // file id; the controller resolves the file and the storage layer
  // applies tenant filtering at read time.
  "/api/files/share/",
  // Hub SPA routes.
  "/hub/",
];

export function isTenantExempt(path: string): boolean {
  if (!path) throw new Error("isTenantExempt: path is required");
  // Strip query string + fragment so /errors?format=json still matches
  // the exempt-exact entry. Browsers and curl pass `req.originalUrl`
  // which includes them.
  const queryAt = path.indexOf("?");
  const hashAt = path.indexOf("#");
  const cut = Math.min(...[queryAt, hashAt].filter((i) => i >= 0), path.length);
  const pure = path.slice(0, cut);
  if (EXEMPT_EXACT.has(pure)) return true;
  for (const prefix of EXEMPT_PREFIXES) {
    if (pure.startsWith(prefix) || pure === prefix.slice(0, -1)) return true;
  }
  return false;
}

export function requiresTenant(path: string): boolean {
  return !isTenantExempt(path);
}
