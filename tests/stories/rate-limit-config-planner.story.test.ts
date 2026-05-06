/**
 * Story: rate-limit-config-planner
 *
 * Covers the pure-planner surface for RateLimitConfig:
 *   - `validateRateLimitConfig` — input validation
 *   - `buildDefaultScopeMap` — all 7 default scopes present
 */
import { describe, expect, it } from "vitest";

import {
  buildDefaultScopeMap,
  validateRateLimitConfig,
} from "../../src/core/throttler/rate-limit-config-planner.js";

describe("validateRateLimitConfig", () => {
  it("rejects maxRequests <= 0", () => {
    const result = validateRateLimitConfig({ maxRequests: 0, windowSeconds: 60 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/maxRequests/);
  });

  it("rejects negative maxRequests", () => {
    const result = validateRateLimitConfig({ maxRequests: -1, windowSeconds: 60 });
    expect(result.ok).toBe(false);
  });

  it("rejects windowSeconds <= 0", () => {
    const result = validateRateLimitConfig({ maxRequests: 10, windowSeconds: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/windowSeconds/);
  });

  it("rejects negative windowSeconds", () => {
    const result = validateRateLimitConfig({ maxRequests: 10, windowSeconds: -5 });
    expect(result.ok).toBe(false);
  });

  it("rejects windowSeconds > 86400 (more than one day)", () => {
    const result = validateRateLimitConfig({ maxRequests: 10, windowSeconds: 86401 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/windowSeconds/);
  });

  it("rejects maxRequests > 100_000", () => {
    const result = validateRateLimitConfig({ maxRequests: 100_001, windowSeconds: 60 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/maxRequests/);
  });

  it("accepts valid config at lower bounds", () => {
    const result = validateRateLimitConfig({ maxRequests: 1, windowSeconds: 1 });
    expect(result.ok).toBe(true);
  });

  it("accepts valid config at upper bounds", () => {
    const result = validateRateLimitConfig({ maxRequests: 100_000, windowSeconds: 86400 });
    expect(result.ok).toBe(true);
  });

  it("accepts a typical production config", () => {
    const result = validateRateLimitConfig({ maxRequests: 100, windowSeconds: 60 });
    expect(result.ok).toBe(true);
  });
});

describe("buildDefaultScopeMap", () => {
  it("contains all 7 required scopes", () => {
    const map = buildDefaultScopeMap();
    const expectedScopes = [
      "global:1s",
      "global:1m",
      "global:1h",
      "auth:signIn",
      "auth:signUp",
      "auth:passwordReset",
      "auth:verifyEmail",
    ];
    for (const scope of expectedScopes) {
      expect(map.has(scope), `scope "${scope}" should be present`).toBe(true);
    }
  });

  it("each scope has positive maxRequests and windowSeconds", () => {
    const map = buildDefaultScopeMap();
    for (const [scope, cfg] of map.entries()) {
      expect(cfg.maxRequests, `scope "${scope}" maxRequests`).toBeGreaterThan(0);
      expect(cfg.windowSeconds, `scope "${scope}" windowSeconds`).toBeGreaterThan(0);
    }
  });

  it("global:1s window is 1 second", () => {
    const map = buildDefaultScopeMap();
    expect(map.get("global:1s")?.windowSeconds).toBe(1);
  });

  it("global:1m window is 60 seconds", () => {
    const map = buildDefaultScopeMap();
    expect(map.get("global:1m")?.windowSeconds).toBe(60);
  });

  it("global:1h window is 3600 seconds", () => {
    const map = buildDefaultScopeMap();
    expect(map.get("global:1h")?.windowSeconds).toBe(3600);
  });

  it("auth:signIn has stricter limits than auth:signUp", () => {
    const map = buildDefaultScopeMap();
    const signIn = map.get("auth:signIn")!;
    const signUp = map.get("auth:signUp")!;
    // signIn should be equal or more restrictive (fewer max requests per time unit)
    const signInRate = signIn.maxRequests / signIn.windowSeconds;
    const signUpRate = signUp.maxRequests / signUp.windowSeconds;
    expect(signInRate).toBeLessThanOrEqual(signUpRate);
  });
});
