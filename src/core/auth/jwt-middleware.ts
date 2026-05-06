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
const STATIC_PUBLIC_PREFIXES = [
  "/health/",
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
  // Derive the auth prefix dynamically so BETTER_AUTH_BASE_PATH is
  // honoured without a server restart side-effect on the static list.
  const authPrefix = resolveAuthPrefix();
  if (path.startsWith(authPrefix) || path === authPrefix.slice(0, -1)) return false;
  for (const prefix of STATIC_PUBLIC_PREFIXES) {
    if (path.startsWith(prefix) || path === prefix.slice(0, -1)) return false;
  }
  return true;
}
