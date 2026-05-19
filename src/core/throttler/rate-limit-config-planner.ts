import { PLAN_OK, type PlanOk } from "../result/plan-ok.js";

/**
 * Pure planners for rate-limit configuration (issue #94).
 *
 * Intentionally free of I/O: all functions here are deterministic and
 * accept only plain data. The service layer wraps these with Prisma
 * reads/writes; the unit tests run them directly without a DB.
 */

export interface ValidateRateLimitConfigInput {
  maxRequests: number;
  windowSeconds: number;
}

export type ValidateRateLimitConfigResult = PlanOk | { ok: false; error: string };

/**
 * Validate an operator-supplied rate-limit window before persisting it.
 *
 * Rules:
 *   - maxRequests must be 1..100_000 (inclusive)
 *   - windowSeconds must be 1..86400 (1 second to 1 day, inclusive)
 */
export function validateRateLimitConfig(
  input: ValidateRateLimitConfigInput,
): ValidateRateLimitConfigResult {
  if (input.maxRequests <= 0) {
    return { ok: false, error: "maxRequests must be greater than 0" };
  }
  if (input.maxRequests > 100_000) {
    return { ok: false, error: "maxRequests must not exceed 100,000" };
  }
  if (input.windowSeconds <= 0) {
    return { ok: false, error: "windowSeconds must be greater than 0" };
  }
  if (input.windowSeconds > 86_400) {
    return { ok: false, error: "windowSeconds must not exceed 86,400 (one day)" };
  }
  return PLAN_OK;
}

export interface ScopeWindow {
  maxRequests: number;
  windowSeconds: number;
}

/**
 * Hardcoded production defaults for all 7 named scopes.
 *
 * The returned Map is the single source of truth for "what does an
 * unconfigured scope look like". `RateLimitConfigService.getWindow()`
 * returns these values when no DB row exists for the scope — the
 * operator DB row wins whenever present.
 */
export function buildDefaultScopeMap(): Map<string, ScopeWindow> {
  const map = new Map<string, ScopeWindow>();

  // Global per-request windows — applied to every route.
  // Ordered from most to least restrictive (burst → sustained → hourly).
  map.set("global:1s", { maxRequests: 20, windowSeconds: 1 });
  map.set("global:1m", { maxRequests: 300, windowSeconds: 60 });
  map.set("global:1h", { maxRequests: 5_000, windowSeconds: 3_600 });

  // Auth-endpoint-specific windows (credential-stuffing mitigations).
  // Values mirror `defaultAuthRateLimits()` in auth/rate-limit.ts so
  // the two sources stay in sync; the dynamic variant reads from the
  // DB (via RateLimitConfigService) and falls back to these numbers.
  map.set("auth:signIn", { maxRequests: 5, windowSeconds: 60 });
  map.set("auth:signUp", { maxRequests: 10, windowSeconds: 60 });
  map.set("auth:passwordReset", { maxRequests: 3, windowSeconds: 3_600 });
  map.set("auth:verifyEmail", { maxRequests: 10, windowSeconds: 3_600 });

  return map;
}
