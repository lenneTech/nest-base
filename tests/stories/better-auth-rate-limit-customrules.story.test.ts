import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";
import { defaultAuthRateLimits } from "../../src/core/auth/rate-limit.js";

/**
 * Story · Better-Auth per-route rate-limit `customRules` (CF.SEC.AUTH_RATE_LIMIT).
 *
 * The PRD's brute-force protection requires more than the global
 * `@nestjs/throttler` because:
 *   - `/sign-in/email` deserves a tighter cap than `/health/live`
 *   - `/forget-password` leaks email-existence by side-channel + must
 *     be the strictest
 *   - `/verify-email` re-sends are routine for users with stale links
 *
 * `defaultAuthRateLimits()` carries the production windows
 * (5/min sign-in · 10/min sign-up · 3/h password reset · 10/h verify);
 * `BetterAuthModule` translates them to Better-Auth's
 * `rateLimit.customRules` map at boot via `buildBetterAuthCustomRules`.
 *
 * Routes Better-Auth honours from `customRules`:
 *   - `/sign-in/*`            (signIn window)
 *   - `/sign-up/*`            (signUp window)
 *   - `/forget-password`      (passwordReset window)
 *   - `/reset-password`       (passwordReset window)
 *   - `/verify-email`         (verifyEmail window)
 *   - `/send-verification-email` (verifyEmail window)
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · Better-Auth per-route rate-limit customRules", () => {
  describe("defaultAuthRateLimits()", () => {
    it("ships the PRD-pinned production windows", () => {
      const limits = defaultAuthRateLimits();
      // Tightest: credential-stuffing surface.
      expect(limits.signIn).toEqual({ maxRequests: 5, windowSeconds: 60 });
      // Slightly looser — captcha catches bot farming downstream.
      expect(limits.signUp).toEqual({ maxRequests: 10, windowSeconds: 60 });
      // Tightest hourly cap — leaks email-existence via the sent mail.
      expect(limits.passwordReset).toEqual({ maxRequests: 3, windowSeconds: 60 * 60 });
      // Verification re-sends are common but not abusive.
      expect(limits.verifyEmail).toEqual({ maxRequests: 10, windowSeconds: 60 * 60 });
    });
  });

  describe("buildBetterAuth() → rateLimit.customRules wiring", () => {
    const BASE_INPUT = {
      secret: "test-secret-32-chars-minimum-aaaaaaaa",
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 3600,
    } as const;

    it("the factory accepts authRateLimits without throwing", () => {
      const auth = buildBetterAuth({
        ...BASE_INPUT,
        authRateLimits: defaultAuthRateLimits(),
      });
      expect(auth).toBeDefined();
      expect(auth.api).toBeDefined();
    });

    it("the factory works without authRateLimits (backward compatibility)", () => {
      const auth = buildBetterAuth(BASE_INPUT);
      expect(auth).toBeDefined();
    });

    it("BetterAuthModule passes defaultAuthRateLimits() into the factory", () => {
      const moduleSrc = readFileSync(resolve(ROOT, "src/core/auth/better-auth.module.ts"), "utf8");
      expect(moduleSrc).toContain("defaultAuthRateLimits");
      expect(moduleSrc).toContain('from "./rate-limit.js"');
      expect(moduleSrc).toMatch(/authRateLimits:\s*defaultAuthRateLimits\(\)/);
    });

    it("buildBetterAuth source defines the customRules translator", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/better-auth.ts"), "utf8");
      expect(src).toContain("buildBetterAuthCustomRules");
      // Path constants the translator emits — Better-Auth's matcher
      // honours wildcards under `/sign-in/*` and `/sign-up/*`.
      expect(src).toContain('"/sign-in/*"');
      expect(src).toContain('"/sign-up/*"');
      expect(src).toContain('"/forget-password"');
      expect(src).toContain('"/reset-password"');
      expect(src).toContain('"/verify-email"');
      expect(src).toContain('"/send-verification-email"');
    });

    it("AuthRateLimitsInput is partial — projects can override individual surfaces", () => {
      // Sign-in only — caller doesn't have to supply every key.
      const auth = buildBetterAuth({
        ...BASE_INPUT,
        authRateLimits: {
          signIn: { windowSeconds: 30, maxRequests: 3 },
        },
      });
      expect(auth).toBeDefined();
    });
  });
});
