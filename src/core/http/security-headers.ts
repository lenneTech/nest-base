import type { AppEnv } from "./cookie-cors-config.js";

/**
 * Helmet + CSP configuration.
 *
 * Per-env tuning:
 *   - production / staging: default-src=self, frame-ancestors=none,
 *     HSTS with preload eligibility, no `unsafe-inline`.
 *   - development: keeps `'unsafe-inline'` on script-src so the dev /
 *     admin panel can use inline bootstrap snippets, HSTS off (no HTTPS
 *     on localhost).
 */

export interface CspDirectives {
  "default-src": string[];
  "script-src": string[];
  "style-src": string[];
  "img-src": string[];
  "connect-src": string[];
  "font-src": string[];
  "object-src": string[];
  "frame-ancestors": string[];
  "base-uri": string[];
  "form-action": string[];
  [key: string]: string[];
}

export interface HstsConfig {
  maxAge: number;
  includeSubDomains: boolean;
  preload: boolean;
}

export interface SecurityHeadersConfig {
  contentSecurityPolicy: { directives: CspDirectives };
  hsts?: HstsConfig;
}

const PROD_CSP: CspDirectives = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "img-src": ["'self'", "data:"],
  "connect-src": ["'self'"],
  "font-src": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

// /api/docs (Scalar) and /dev sidebar use rsms.me (Inter) + jsdelivr (Scalar
// JS bundle). In production those static assets should be self-hosted, but
// in dev we trust the upstream CDNs so the docs page renders out of the box.
const DEV_CDN_HOSTS = ["https://cdn.jsdelivr.net", "https://rsms.me"];

const DEV_CSP: CspDirectives = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'", ...DEV_CDN_HOSTS],
  "style-src": ["'self'", "'unsafe-inline'", ...DEV_CDN_HOSTS],
  "img-src": ["'self'", "data:", "http:", "https:"],
  "connect-src": ["'self'", "ws:", "wss:", "http://localhost:*", "https://localhost:*"],
  "font-src": ["'self'", "data:", ...DEV_CDN_HOSTS],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
};

const HSTS_PROD: HstsConfig = {
  // 365 days — Chrome's HSTS preload list requires \xe2\x89\xa5 1 year.
  maxAge: 60 * 60 * 24 * 365,
  includeSubDomains: true,
  preload: true,
};

export function buildSecurityHeadersConfig(env: AppEnv): SecurityHeadersConfig {
  if (env === "development") {
    return { contentSecurityPolicy: { directives: DEV_CSP } };
  }
  return { contentSecurityPolicy: { directives: PROD_CSP }, hsts: HSTS_PROD };
}

/**
 * Returns the strict (PROD-shape) CSP. The path-aware override
 * middleware uses this to overwrite the CSP header on JSON-shaped
 * responses regardless of env so dev-mode JSON APIs don't carry the
 * lenient `unsafe-inline` directive.
 */
export function strictCspDirectives(): CspDirectives {
  return PROD_CSP;
}

/**
 * Serialise CSP directives into the canonical
 * `directive value1 value2; directive2 value1;` header form. Used by
 * the path-aware middleware to emit the override.
 */
export function serializeCsp(directives: CspDirectives): string {
  const parts: string[] = [];
  for (const key of Object.keys(directives)) {
    const values = directives[key];
    if (!values || values.length === 0) continue;
    parts.push(`${key} ${values.join(" ")}`);
  }
  return parts.join("; ");
}

/**
 * Pure planner — given a request path + Accept header + an
 * already-emitted Content-Type, decide whether the response should
 * carry the strict CSP override. Two layers of evidence:
 *
 *   1. Path prefix — `/api/` is exclusively a JSON API surface.
 *   2. Accept header — `application/json` (or `*\/*` with no HTML)
 *      is a pre-response signal we can rely on without inspecting
 *      the response body.
 *
 * The dev-hub HTML pages live under `/dev/` and `/admin/` — those
 * routes also expose a `*.json` companion, so we ALSO match
 * `*.json` suffixes so JSON companions of HTML pages get the strict
 * CSP without needing to wait for the response Content-Type.
 *
 * Public catalog endpoints (`/health/live`, `/health/ready`,
 * `/errors`) emit JSON; we match them via the Accept header
 * `application/json` (the request comes from k8s probes / SDK
 * consumers that set Accept: application/json explicitly).
 */
export interface PathAwareCspInput {
  readonly path: string;
  readonly acceptHeader: string | undefined;
  readonly responseContentType: string | undefined;
}

export function isJsonShapedResponse(input: PathAwareCspInput): boolean {
  const path = input.path;
  // `/api/hub/*` and `/api/admin/*` paths are HTML pages in the dev-hub
  // SPA (they return the shell HTML, not JSON). Their `*.json` companion
  // paths are caught below by the `.json` suffix branch. Applying the
  // strict CSP here would strip `unsafe-inline` and break the SPA.
  if (
    path.startsWith("/api/") &&
    !path.startsWith("/api/hub/") &&
    !path.startsWith("/api/admin/")
  ) {
    return true;
  }
  if (path.endsWith(".json")) return true;
  // Allow-list a small set of well-known JSON paths. We deliberately
  // don't include `/admin/` or `/dev/` (those are HTML by default;
  // their `.json` siblings hit the suffix branch above).
  if (path === "/health/live" || path === "/health/ready") return true;
  if (path === "/api/errors" || path === "/errors") return true;

  const accept = (input.acceptHeader ?? "").toLowerCase();
  const contentType = (input.responseContentType ?? "").toLowerCase();
  if (contentType.includes("application/json")) return true;
  if (
    accept === "application/json" ||
    accept.startsWith("application/json,") ||
    accept.startsWith("application/json;")
  ) {
    return true;
  }
  return false;
}
