/**
 * Path-classification for the tenant-guard.
 *
 * Public/system paths (/, /health/*, /api/auth/*) are exempt from the
 * tenant-header requirement. Everything else needs the header to be
 * present and parseable as a UUID.
 *
 * The actual NestJS Guard wraps this classifier in a future slice.
 *
 * Issue #101: the Better-Auth prefix is derived from
 * `BETTER_AUTH_BASE_PATH` at runtime so a custom mount keeps the
 * tenant-header exemption without additional code changes.
 */

import { BETTER_AUTH_DEFAULT_MOUNT_PATH } from "../auth/better-auth-config.js";

/**
 * Resolve the Better-Auth prefix that should be exempt from the
 * tenant-header requirement. Reads `BETTER_AUTH_BASE_PATH` at call
 * time so tests that mutate the env variable get the correct value.
 */
function resolveAuthExemptPrefix(): string {
  const raw = process.env.BETTER_AUTH_BASE_PATH ?? BETTER_AUTH_DEFAULT_MOUNT_PATH;
  return raw.endsWith("/") ? raw : `${raw}/`;
}

// `/api-docs-json` is the deprecated legacy alias for
// `/api/openapi.json` — exempt from the tenant header because SDK
// generators that hit the legacy URL don't carry a tenant context
// (mirrors the canonical doc's exemption). Removed once
// lenneTech/nuxt-base-starter#13 has propagated.
//
// Issue #83: all API routes are now under `/api/*`. Hub, admin, and
// errors pages sit at root level without the /api prefix.
const EXEMPT_EXACT = new Set([
  "/",
  // API identity endpoint (AppController at GET /api/ — no tenant context needed).
  "/api/",
  "/api",
  // /errors is the public error-code catalogue served without /api prefix.
  "/errors",
  // Legacy /api/errors — kept exempt so any cached SDK calls still work.
  "/api/errors",
  "/api/tenants",
  "/api-docs-json",
  "/api/metrics",
  // OpenAPI SPA page (no /api prefix after fix).
  "/openapi",
]);
// `/api/me/*` endpoints operate on the authenticated user (req.user.id),
// not on a specific tenant. `/api/tenants` is the self-service tenant CRUD
// surface — a signed-up user creates their first tenant here, so the
// header cannot be required at the bootstrap step.
const STATIC_EXEMPT_PREFIXES = [
  "/health/",
  "/docs/",
  // Hub static assets only — SPA HTML/JSON resolve tenant via session.
  "/hub/static/",
  "/errors/",
  "/api/me/",
  "/api/tenants/",
  // Share-token endpoints — the token's HMAC envelope encodes the
  // file id; the controller resolves the file and the storage layer
  // applies tenant filtering at read time.
  "/api/files/share/",
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
  // Derive the auth prefix dynamically so BETTER_AUTH_BASE_PATH is
  // honoured without requiring a restart-triggered module reload.
  const authPrefix = resolveAuthExemptPrefix();
  if (pure.startsWith(authPrefix) || pure === authPrefix.slice(0, -1)) return true;
  for (const prefix of STATIC_EXEMPT_PREFIXES) {
    if (pure.startsWith(prefix) || pure === prefix.slice(0, -1)) return true;
  }
  return false;
}

export function requiresTenant(path: string): boolean {
  return !isTenantExempt(path);
}
