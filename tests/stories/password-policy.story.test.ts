import { describe, expect, it } from "vitest";

import {
  PasswordPolicyError,
  buildHibpBreachCheck,
  estimatePasswordEntropy,
  fetchHibpRange,
  parseHibpRangeBody,
  validatePasswordPolicy,
} from "../../src/core/auth/password-policy.js";

/**
 * Story · Password policy (CF.AUTH.* — iter-96 review Finding 13).
 *
 * The PRD pins "Password policy (entropy + breach checks)" — Better-Auth
 * register / change-password hooks should reject passwords that are
 * either too low-entropy OR known-breached via HIBP k-anonymity.
 *
 * Three layers covered:
 *   1. `estimatePasswordEntropy(password)` — pure planner returning
 *      Shannon-bit entropy estimate based on character-class diversity.
 *   2. `buildHibpBreachCheck({fetchRange})` — async checker using the
 *      HIBP k-anonymity API: SHA-1 the password, send the first 5 hex
 *      chars to `api.pwnedpasswords.com/range/<prefix>`, scan the
 *      response for the suffix.
 *   3. `validatePasswordPolicy(password, options, breachCheck?)` —
 *      composes the two; throws `PasswordPolicyError` with reason on
 *      reject. Better-Auth signup/change hooks call this before
 *      hashing the password.
 */
describe("Story · Password policy", () => {
  describe("estimatePasswordEntropy", () => {
    it("returns 0 for empty / single-class strings", () => {
      expect(estimatePasswordEntropy("")).toBe(0);
      expect(estimatePasswordEntropy("a")).toBeLessThan(8);
    });

    it("recognises four character classes (lowercase + uppercase + digits + symbols)", () => {
      // Each class doubles the alphabet; 4 classes ≈ 95 chars; 12-char password
      // → ~78.8 bits.
      const e = estimatePasswordEntropy("Abcd1234!@#$");
      expect(e).toBeGreaterThan(60);
      expect(e).toBeLessThan(100);
    });

    it("scales with length (longer ⇒ higher entropy)", () => {
      const short = estimatePasswordEntropy("Abc1!");
      const long = estimatePasswordEntropy("Abcdef1234!@");
      expect(long).toBeGreaterThan(short);
    });

    it("is deterministic — same input ⇒ same output", () => {
      const a = estimatePasswordEntropy("ProjectK!ck-Off-2026");
      const b = estimatePasswordEntropy("ProjectK!ck-Off-2026");
      expect(a).toBe(b);
    });
  });

  describe("buildHibpBreachCheck", () => {
    it("hashes via SHA-1, queries the prefix endpoint, finds the suffix", async () => {
      // Known: SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
      // Prefix = 5BAA6, suffix = 1E4C9B93F3F0682250B6CF8331B7EE68FD8
      let calledPrefix: string | null = null;
      const check = buildHibpBreachCheck({
        async fetchRange(prefix: string) {
          calledPrefix = prefix;
          // Return one matching suffix + a non-match.
          return [
            { suffix: "1E4C9B93F3F0682250B6CF8331B7EE68FD8", count: 999_999 },
            { suffix: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", count: 1 },
          ];
        },
      });
      const result = await check("password");
      expect(calledPrefix).toBe("5BAA6");
      expect(result.breached).toBe(true);
      if (result.breached) {
        expect(result.count).toBe(999_999);
      }
    });

    it("returns {breached: false} when the suffix isn't found", async () => {
      const check = buildHibpBreachCheck({
        async fetchRange() {
          return [{ suffix: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", count: 1 }];
        },
      });
      const result = await check("an-extremely-rare-passphrase-12345!");
      expect(result.breached).toBe(false);
    });

    it("HIBP transport errors propagate — caller decides whether to fail-open or fail-closed", async () => {
      const check = buildHibpBreachCheck({
        async fetchRange() {
          throw new Error("hibp: 503");
        },
      });
      await expect(check("password")).rejects.toThrow(/hibp/i);
    });
  });

  describe("validatePasswordPolicy", () => {
    it("accepts a strong password (high entropy, not breached)", async () => {
      const breachCheck = async () => ({ breached: false }) as const;
      await expect(
        validatePasswordPolicy("ProjectK!ck-Off-2026-AB", { minEntropyBits: 50 }, breachCheck),
      ).resolves.toBeUndefined();
    });

    it("rejects a low-entropy password with reason='entropy'", async () => {
      const breachCheck = async () => ({ breached: false }) as const;
      const err = await catchAsync(() =>
        validatePasswordPolicy("abc", { minEntropyBits: 50 }, breachCheck),
      );
      expect(err).toBeInstanceOf(PasswordPolicyError);
      expect((err as PasswordPolicyError).reason).toBe("entropy");
    });

    it("rejects a breached password with reason='breached' even if entropy is high", async () => {
      const breachCheck = async () => ({ breached: true, count: 50_000 }) as const;
      const err = await catchAsync(() =>
        validatePasswordPolicy("ProjectK!ck-Off-2026", { minEntropyBits: 50 }, breachCheck),
      );
      expect(err).toBeInstanceOf(PasswordPolicyError);
      expect((err as PasswordPolicyError).reason).toBe("breached");
    });

    it("breach check is optional — passes when only entropy is checked + meets threshold", async () => {
      await expect(
        validatePasswordPolicy("ProjectK!ck-Off-2026", { minEntropyBits: 50 }),
      ).resolves.toBeUndefined();
    });

    it("default minEntropyBits is reasonable (≥40 bits)", async () => {
      // No options → uses defaults; "abc" should still fail.
      const err = await catchAsync(() => validatePasswordPolicy("abc"));
      expect(err).toBeInstanceOf(PasswordPolicyError);
    });
  });
});

async function catchAsync(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

/**
 * Iter-159: cover the pure HIBP body parser + the `fetchHibpRange`
 * non-OK error path. The successful fetch path stays untested at
 * the unit layer (tests must not call the real api.pwnedpasswords.com)
 * — `buildHibpBreachCheck`'s fetchRange-injection seam is the
 * canonical test pattern (covered above).
 */
describe("Story · parseHibpRangeBody (HIBP range parser, iter-159)", () => {
  it("parses a well-formed body with two entries", () => {
    const body = "ABCDE:5\r\nF1234:42";
    const entries = parseHibpRangeBody(body);
    expect(entries).toEqual([
      { suffix: "ABCDE", count: 5 },
      { suffix: "F1234", count: 42 },
    ]);
  });

  it("skips empty lines + leading/trailing whitespace", () => {
    const body = "\n   \nABCDE:7\n   \nF1234:9\n\n";
    const entries = parseHibpRangeBody(body);
    expect(entries.map((e) => e.suffix)).toEqual(["ABCDE", "F1234"]);
  });

  it("skips lines without a colon (malformed)", () => {
    const body = "ABCDE:5\nNOCOLON\nF1234:9";
    const entries = parseHibpRangeBody(body);
    expect(entries.map((e) => e.suffix)).toEqual(["ABCDE", "F1234"]);
  });

  it("skips entries with non-numeric counts", () => {
    const body = "ABCDE:notanumber\nF1234:9";
    const entries = parseHibpRangeBody(body);
    expect(entries).toEqual([{ suffix: "F1234", count: 9 }]);
  });

  it("returns empty array for empty body", () => {
    expect(parseHibpRangeBody("")).toEqual([]);
  });
});

describe("Story · fetchHibpRange error path (iter-159)", () => {
  it("throws when the HIBP API returns non-200", async () => {
    // Inject a fetch stub via globalThis. The native fetch is
    // restored in `finally` so the test stays self-contained.
    const originalFetch = globalThis.fetch;
    const fakeFetch: unknown = async () => ({
      ok: false,
      status: 503,
      text: async () => "",
    });
    globalThis.fetch = fakeFetch as typeof fetch;
    try {
      await expect(fetchHibpRange("ABCDE")).rejects.toThrow(/status=503/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns parsed entries on a successful response", async () => {
    const originalFetch = globalThis.fetch;
    const fakeFetch: unknown = async () => ({
      ok: true,
      status: 200,
      text: async () => "ABCDE:7\nF1234:42",
    });
    globalThis.fetch = fakeFetch as typeof fetch;
    try {
      const entries = await fetchHibpRange("12345");
      expect(entries).toEqual([
        { suffix: "ABCDE", count: 7 },
        { suffix: "F1234", count: 42 },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
