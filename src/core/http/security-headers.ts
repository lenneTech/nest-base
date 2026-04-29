import type { AppEnv } from "./cookie-cors-config.js";

/**
 * Helmet + CSP configuration (PLAN.md §30).
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

const DEV_CSP: CspDirectives = {
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "http:", "https:"],
  "connect-src": ["'self'", "ws:", "wss:", "http://localhost:*", "https://localhost:*"],
  "font-src": ["'self'", "data:"],
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
