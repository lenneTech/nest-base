import { describe, expect, it } from "vitest";

import { pinTestNodeEnv } from "../../src/core/testing/pin-test-node-env.js";

/**
 * Smoke + planner test for the NODE_ENV pinning helper.
 *
 * Friction-log run 2026-05-03-06-15-57: Bun auto-loads `.env`, which
 * normally ships `NODE_ENV=development` in a fresh consumer workspace.
 * `tests/unit/test-infrastructure.spec.ts` then fails its
 * `expect(process.env.NODE_ENV).toBe("test")` assertion because the
 * legacy globalSetup either runs too late (after worker fork) or
 * doesn't run for the unit-only path. The fix layers
 * `setupFiles: ['tests/setup-files/pin-node-env.ts']` on top so every
 * worker pins NODE_ENV before any user test code touches it.
 *
 * The pinner itself is a pure planner (`pinTestNodeEnv`) so we can
 * unit-test the override behaviour without poisoning the worker.
 */
describe("Test-Env · pinTestNodeEnv()", () => {
  it("forces NODE_ENV to 'test' when the input env says 'development' (Bun .env autoload case)", () => {
    const env: Record<string, string | undefined> = { NODE_ENV: "development" };
    pinTestNodeEnv(env);
    expect(env.NODE_ENV).toBe("test");
  });

  it("forces NODE_ENV to 'test' when the input env is empty (no autoload)", () => {
    const env: Record<string, string | undefined> = {};
    pinTestNodeEnv(env);
    expect(env.NODE_ENV).toBe("test");
  });

  it("leaves NODE_ENV='test' alone (idempotent)", () => {
    const env: Record<string, string | undefined> = { NODE_ENV: "test" };
    pinTestNodeEnv(env);
    expect(env.NODE_ENV).toBe("test");
  });

  it("overrides every non-test value, including 'production' (a misconfigured CI must not pass quietly)", () => {
    for (const value of ["production", "staging", "development", "DEV", " test"]) {
      const env: Record<string, string | undefined> = { NODE_ENV: value };
      pinTestNodeEnv(env);
      expect(env.NODE_ENV).toBe("test");
    }
  });

  it("never throws on a frozen-like Record (defensive: caller-supplied env)", () => {
    const env: Record<string, string | undefined> = { NODE_ENV: "development" };
    expect(() => pinTestNodeEnv(env)).not.toThrow();
  });

  it("the live process.env was pinned to 'test' before this test ran (setupFile contract)", () => {
    // This is the integration assertion the friction log called for:
    // running `bun run test:unit` on a fresh workspace whose `.env`
    // says `NODE_ENV=development` must STILL show NODE_ENV=test here.
    expect(process.env.NODE_ENV).toBe("test");
  });
});
