/**
 * Path-classification for the tenant-guard.
 *
 * Public/system paths (/, /health/*, /api/auth/*) are exempt from the
 * tenant-header requirement. Everything else needs the header to be
 * present and parseable as a UUID.
 *
 * The actual NestJS Guard wraps this classifier in a future slice.
 */

const EXEMPT_EXACT = new Set(["/", "/errors", "/tenants"]);
// `/me/*` endpoints operate on the authenticated user (req.user.id),
// not on a specific tenant. `/tenants` is the self-service tenant CRUD
// surface — a signed-up user creates their first tenant here, so the
// header cannot be required at the bootstrap step.
const EXEMPT_PREFIXES = [
  "/health/",
  "/api/auth/",
  "/docs/",
  "/dev/",
  "/admin/",
  "/errors/",
  "/me/",
  "/tenants/",
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
