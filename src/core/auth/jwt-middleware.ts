/**
 * JWT-middleware path classification.
 *
 * Allowlist-driven: by default every API path requires a valid session
 * or scoped API key. The `PUBLIC_PREFIXES` set is the only escape hatch
 * — it covers diagnostics, the Better-Auth handler, and the docs UI.
 *
 * Issue #83: all API routes are now under `/api/*`. Hub, admin, and
 * errors pages live at root level (`/hub/*` incl. `/hub/admin/*`, `/errors`).
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
 * Hub and admin SPA pages now live at /hub/* incl. /hub/admin/* (no /api; legacy /admin/* 308s there
 * prefix) following the routing fix.
 *
 * MAJ-2: When `OPENAPI_REQUIRE_AUTH=true` is set (default in
 * production), the OpenAPI spec endpoints (`/api/openapi`,
 * `/api/openapi.json`, `/api-docs-json`, `/openapi`) are removed from
 * the public allowlist — they require a valid JWT session. This
 * prevents unauthenticated clients from enumerating all API routes
 * and schemas.
 * Default: required in production, public in development/staging.
 */
function resolveOpenapiRequireAuth(): boolean {
  const raw = process.env.OPENAPI_REQUIRE_AUTH;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  // Default: require auth in production, allow public in dev/staging.
  return (process.env.NODE_ENV ?? "development") === "production";
}

const BASE_STATIC_PUBLIC_PREFIXES = [
  "/health/",
  "/docs/",
  // Hub SPA static assets only — HTML/JSON under /hub/* require a session.
  "/hub/static/",
  "/errors/",
  // HMAC-signed share links — the token is the auth.
  "/api/files/share/",
];

const OPENAPI_PUBLIC_PREFIXES = [
  "/openapi",
  // /api/openapi.json — raw JSON data endpoint consumed by SDK generators.
  // Still at /api/openapi.json (unlike the SPA viewer page which moved to /openapi).
  "/api/openapi",
];

const BASE_PUBLIC_EXACT = new Set([
  "/",
  // API identity endpoint (AppController @Get() under the global /api/ prefix).
  "/api/",
  "/api",
  "/errors",
  // Legacy /api/errors — kept public so cached SDK calls still work.
  "/api/errors",
]);

const OPENAPI_PUBLIC_EXACT = new Set(["/openapi", "/api-docs-json"]);

function resolvePublicPrefixes(): string[] {
  if (resolveOpenapiRequireAuth()) {
    return BASE_STATIC_PUBLIC_PREFIXES;
  }
  return [...BASE_STATIC_PUBLIC_PREFIXES, ...OPENAPI_PUBLIC_PREFIXES];
}

function resolvePublicExact(): Set<string> {
  if (resolveOpenapiRequireAuth()) {
    return BASE_PUBLIC_EXACT;
  }
  return new Set([...BASE_PUBLIC_EXACT, ...OPENAPI_PUBLIC_EXACT]);
}

// isPathProtected() re-resolves public path lists on every call so
// env changes (OPENAPI_REQUIRE_AUTH, BETTER_AUTH_BASE_PATH) are
// honoured without a module re-import. No module-level snapshots needed.

export function isPathProtected(path: string): boolean {
  if (!path) throw new Error("isPathProtected: path is required");
  // Resolve both lists dynamically on every call so env-var changes
  // (OPENAPI_REQUIRE_AUTH, BETTER_AUTH_BASE_PATH) are reflected
  // without a module re-import.
  const publicExact = resolvePublicExact();
  const publicPrefixes = resolvePublicPrefixes();
  if (publicExact.has(path)) return false;
  // Derive the auth prefix dynamically so BETTER_AUTH_BASE_PATH is
  // honoured without a server restart side-effect on the static list.
  const authPrefix = resolveAuthPrefix();
  if (path.startsWith(authPrefix) || path === authPrefix.slice(0, -1)) return false;
  for (const prefix of publicPrefixes) {
    if (path.startsWith(prefix) || path === prefix.slice(0, -1)) return false;
  }
  return true;
}
