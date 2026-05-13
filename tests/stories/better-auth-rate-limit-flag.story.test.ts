import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";
import { isBetterAuthRateLimitEnabled } from "../../src/core/auth/rate-limit-flag.js";

/**
 * Story · BETTER_AUTH_RATE_LIMIT_ENABLED env flag (issue #98).
 *
 * WHY: The Better-Auth rate-limiter trips up local dev + CI — every
 * rapid test run or hot-reload sequence exhausts the window and returns
 * 429s. Introducing BETTER_AUTH_RATE_LIMIT_ENABLED lets operators opt
 * out of the limiter in those environments without touching production.
 *
 * Contract:
 *   - Flag is `false` by default when NODE_ENV is "test" or "development".
 *   - Flag is `true` by default in all other envs (production, staging, …).
 *   - When BETTER_AUTH_RATE_LIMIT_ENABLED="false" the factory receives
 *     no `authRateLimits`, so Better-Auth boots without its rate-limiter.
 *   - When BETTER_AUTH_RATE_LIMIT_ENABLED="true" (or absent in production)
 *     the full rate-limit config is wired.
 *   - BetterAuthModule reads the flag at provider-init time (not at module
 *     decoration time) so tests that set process.env in beforeAll see it.
 */

const ROOT = resolve(import.meta.dirname, "..", "..");

describe("Story · BETTER_AUTH_RATE_LIMIT_ENABLED flag", () => {
  describe("isBetterAuthRateLimitEnabled()", () => {
    it("returns false when NODE_ENV=test and flag is unset", () => {
      expect(isBetterAuthRateLimitEnabled({ NODE_ENV: "test" })).toBe(false);
    });

    it("returns false when NODE_ENV=development and flag is unset", () => {
      expect(isBetterAuthRateLimitEnabled({ NODE_ENV: "development" })).toBe(false);
    });

    it("returns true when NODE_ENV=production and flag is unset", () => {
      expect(isBetterAuthRateLimitEnabled({ NODE_ENV: "production" })).toBe(true);
    });

    it("returns true when NODE_ENV=staging and flag is unset", () => {
      expect(isBetterAuthRateLimitEnabled({ NODE_ENV: "staging" })).toBe(true);
    });

    it("explicit BETTER_AUTH_RATE_LIMIT_ENABLED=false overrides production default", () => {
      expect(
        isBetterAuthRateLimitEnabled({
          NODE_ENV: "production",
          BETTER_AUTH_RATE_LIMIT_ENABLED: "false",
        }),
      ).toBe(false);
    });

    it("explicit BETTER_AUTH_RATE_LIMIT_ENABLED=true overrides test default", () => {
      expect(
        isBetterAuthRateLimitEnabled({
          NODE_ENV: "test",
          BETTER_AUTH_RATE_LIMIT_ENABLED: "true",
        }),
      ).toBe(true);
    });

    it("explicit BETTER_AUTH_RATE_LIMIT_ENABLED=true overrides development default", () => {
      expect(
        isBetterAuthRateLimitEnabled({
          NODE_ENV: "development",
          BETTER_AUTH_RATE_LIMIT_ENABLED: "true",
        }),
      ).toBe(true);
    });

    it("returns true when NODE_ENV is absent (unset = assume production-like)", () => {
      expect(isBetterAuthRateLimitEnabled({})).toBe(true);
    });
  });

  describe("buildBetterAuth() respects the flag via rateLimitEnabled input", () => {
    const BASE_INPUT = {
      secret: "test-secret-that-is-at-least-64-characters-long-for-testing-purposes",
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 3600,
    } as const;

    it("when rateLimitEnabled=false the factory does not attach rateLimit config", () => {
      const auth = buildBetterAuth({
        ...BASE_INPUT,
        rateLimitEnabled: false,
      });
      // Better-Auth's options shape is available at auth.options; when
      // no authRateLimits were wired the rateLimit key is absent.
      expect((auth.options as Record<string, unknown>).rateLimit).toBeUndefined();
    });

    it("when rateLimitEnabled=true the factory attaches rateLimit customRules", () => {
      const auth = buildBetterAuth({
        ...BASE_INPUT,
        rateLimitEnabled: true,
        authRateLimits: { signIn: { windowSeconds: 60, maxRequests: 5 } },
      });
      expect((auth.options as Record<string, unknown>).rateLimit).toBeDefined();
    });

    it("rateLimitEnabled defaults to true when not supplied (backward compat)", () => {
      const auth = buildBetterAuth({
        ...BASE_INPUT,
        authRateLimits: { signIn: { windowSeconds: 60, maxRequests: 5 } },
      });
      // Rate limits should still be wired when rateLimitEnabled is absent.
      expect((auth.options as Record<string, unknown>).rateLimit).toBeDefined();
    });
  });

  describe("BetterAuthModule source wires the flag", () => {
    it("module reads BETTER_AUTH_RATE_LIMIT_ENABLED at factory time", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/better-auth.module.ts"), "utf8");
      expect(src).toContain("BETTER_AUTH_RATE_LIMIT_ENABLED");
    });

    it("module imports isBetterAuthRateLimitEnabled", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/better-auth.module.ts"), "utf8");
      expect(src).toContain("isBetterAuthRateLimitEnabled");
    });
  });

  describe(".env.example documents the flag", () => {
    it("BETTER_AUTH_RATE_LIMIT_ENABLED appears in .env.example", () => {
      const committed = readFileSync(resolve(ROOT, ".env.example"), "utf8");
      expect(committed).toContain("BETTER_AUTH_RATE_LIMIT_ENABLED");
    });
  });
});
