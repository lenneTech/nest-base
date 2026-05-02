import { describe, expect, it } from "vitest";

import { withNodeEnv } from "../lib/with-node-env.js";

/**
 * Story · `withNodeEnv` helper.
 *
 * Several e2e specs flip `process.env.NODE_ENV` mid-suite to test
 * production / development behaviour. If a spec fails before its
 * `afterAll` reset runs, `NODE_ENV` leaks to the next spec in the
 * worker — and `parseTestAbilityHeader` early-returns when
 * `NODE_ENV !== "test"`, silently 403'ing every subsequent spec
 * that relies on the test-ability hatch.
 *
 * `withNodeEnv(value, fn)` wraps the env mutation in a try/finally
 * so the previous value is always restored — even when `fn` throws.
 * It's the only sanctioned way to flip `NODE_ENV` from a test.
 */
describe("Story · withNodeEnv", () => {
  it("sets NODE_ENV to the requested value while fn runs", async () => {
    const previous = process.env.NODE_ENV;

    const observed = await withNodeEnv("development", async () => process.env.NODE_ENV);

    expect(observed).toBe("development");
    expect(process.env.NODE_ENV).toBe(previous);
  });

  it("restores the previous NODE_ENV after fn resolves", async () => {
    const previous = process.env.NODE_ENV;

    await withNodeEnv("production", async () => {
      expect(process.env.NODE_ENV).toBe("production");
    });

    expect(process.env.NODE_ENV).toBe(previous);
  });

  it("restores the previous NODE_ENV even when fn throws", async () => {
    const previous = process.env.NODE_ENV;

    await expect(
      withNodeEnv("production", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(process.env.NODE_ENV).toBe(previous);
  });

  it("returns the value resolved by fn", async () => {
    const result = await withNodeEnv("development", async () => 42);
    expect(result).toBe(42);
  });

  it("preserves an undefined previous NODE_ENV (not stringified)", async () => {
    const previous = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      await withNodeEnv("test", async () => {
        expect(process.env.NODE_ENV).toBe("test");
      });
      expect(process.env.NODE_ENV).toBeUndefined();
    } finally {
      // Restore for downstream tests in the same worker.
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});
