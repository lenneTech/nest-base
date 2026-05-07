/**
 * JWT-middleware path classification.
 *
 * Allowlist-driven: by default every API path requires a valid session
 * or scoped API key. The `PUBLIC_PREFIXES` set is the only escape hatch
 * — it covers diagnostics, the Better-Auth handler, and the docs UI.
 *
 * Issue #83: all API routes are now under `/api/*`. Hub, admin, and
 * errors pages live at root level (`/hub/*`, `/admin/*`, `/errors`).
 * Health probes remain at `/health/*`. The legacy `/api-docs-json`
 * alias is exempt for SDK backward compatibility.
 *
 * Issue #101: the Better-Auth prefix entry is derived from
 * `BETTER_AUTH_BASE_PATH` at server-boot time so operators can mount
 * Better-Auth under a custom path without code changes. The static
 * `/api/auth/` default is always included as a fallback so the
 * allowlist never becomes empty.
 */

import { BETTER_AUTH_DEFAULT_MOUNT_PATH } from "./better-auth-config.js";

/**
 * Resolve the Better-Auth prefix that should be treated as public by
 * the JWT middleware. Reads `BETTER_AUTH_BASE_PATH` at call time so
 * the value is fresh even in test scenarios where env vars are mutated
 * between test cases.
 */
function resolveAuthPrefix(): string {
  const raw = process.env.BETTER_AUTH_BASE_PATH ?? BETTER_AUTH_DEFAULT_MOUNT_PATH;
  // Ensure the prefix ends with "/" so startsWith() matches sub-paths
  // but not unrelated paths that share a prefix (e.g. `/api/authoring`).
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/**
 * Public paths — no JWT required.
 *
 * `/errors` (and legacy `/api/errors`) is the public error-code
 * catalogue — frontends + SDK generators consume it without
 * authenticating. `/openapi` (SPA page) and `/api/openapi.json`
 * serve the OpenAPI spec the SDK generators read. Both are
 * dev-friendly (they expose error codes / route shapes only,
 * never user data) and intentionally outside the auth wall.
 *
 * `/api-docs-json` is the deprecated legacy alias for the OpenAPI
 * doc, kept exempt for the same reason as `/api/openapi.json` until
 * the upstream `nuxt-base-starter` fix
 * (lenneTech/nuxt-base-starter#13) has propagated.
 *
 * Hub and admin SPA pages now live at /hub/* and /admin/* (no /api
 * prefix) following the routing fix.
 */
const STATIC_PUBLIC_PREFIXES = [
  "/health/",
  "/docs/",
  // Hub and admin SPA pages at root level (no /api prefix).
  "/hub/",
  "/admin/",
  "/errors/",
  "/openapi",
  // /api/openapi.json — raw JSON data endpoint consumed by SDK generators.
  // Still at /api/openapi.json (unlike the SPA viewer page which moved to /openapi).
  "/api/openapi",
  // HMAC-signed share links — the token is the auth.
  "/api/files/share/",
];
const PUBLIC_EXACT = new Set([
  "/",
  // API identity endpoint (AppController @Get() under the global /api/ prefix).
  "/api/",
  "/api",
  "/errors",
  // Legacy /api/errors — kept public so cached SDK calls still work.
  "/api/errors",
  "/openapi",
  "/api-docs-json",
  "/hub/login",
  "/hub/logout",
  "/hub",
]);

export function isPathProtected(path: string): boolean {
  if (!path) throw new Error("isPathProtected: path is required");
  if (PUBLIC_EXACT.has(path)) return false;
  // Derive the auth prefix dynamically so BETTER_AUTH_BASE_PATH is
  // honoured without a server restart side-effect on the static list.
  const authPrefix = resolveAuthPrefix();
  if (path.startsWith(authPrefix) || path === authPrefix.slice(0, -1)) return false;
  for (const prefix of STATIC_PUBLIC_PREFIXES) {
    if (path.startsWith(prefix) || path === prefix.slice(0, -1)) return false;
  }
  return true;
}
