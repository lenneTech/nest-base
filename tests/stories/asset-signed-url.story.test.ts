import { describe, expect, it } from "vitest";

import { signUrlToken, verifySignUrlToken } from "../../src/core/files/signed-url-token.js";

/**
 * Story · Asset Signed-URL HMAC tokens (CRIT-2).
 *
 * `signUrl()` on local and postgres storage adapters now appends an
 * HMAC-SHA256 `sig` parameter so the expiry timestamp cannot be forged.
 * The asset controller verifies the signature before serving the asset.
 *
 * Cases:
 *   - valid signature → access granted (200 in HTTP, `true` from verify)
 *   - wrong/tampered signature → reject (403 in HTTP, `false` from verify)
 *   - expired timestamp with valid signature → 410 Gone (handled in controller)
 *   - no secret configured (dev-mode) → verification always passes
 */
describe("Story · Asset Signed-URL HMAC tokens", () => {
  const SECRET = "test-secret-32-chars-long-enough!";
  const KEY = "tenant-a/uploads/photo.jpg";
  const EXPIRES = 1_900_000_000; // far future

  describe("signUrlToken", () => {
    it("produces a 32-char hex string", () => {
      const token = signUrlToken(KEY, EXPIRES, SECRET);
      expect(token).toHaveLength(32);
      expect(token).toMatch(/^[0-9a-f]{32}$/);
    });

    it("is deterministic for the same key + expires + secret", () => {
      const a = signUrlToken(KEY, EXPIRES, SECRET);
      const b = signUrlToken(KEY, EXPIRES, SECRET);
      expect(a).toBe(b);
    });

    it("differs when the key changes", () => {
      const a = signUrlToken(KEY, EXPIRES, SECRET);
      const b = signUrlToken("other-key.jpg", EXPIRES, SECRET);
      expect(a).not.toBe(b);
    });

    it("differs when the expiry changes", () => {
      const a = signUrlToken(KEY, EXPIRES, SECRET);
      const b = signUrlToken(KEY, EXPIRES + 1, SECRET);
      expect(a).not.toBe(b);
    });

    it("differs when the secret changes", () => {
      const a = signUrlToken(KEY, EXPIRES, SECRET);
      const b = signUrlToken(KEY, EXPIRES, "different-secret");
      expect(a).not.toBe(b);
    });
  });

  describe("verifySignUrlToken", () => {
    it("returns true for a valid (key, expires, sig, secret) tuple", () => {
      const sig = signUrlToken(KEY, EXPIRES, SECRET);
      expect(verifySignUrlToken(KEY, EXPIRES, sig, SECRET)).toBe(true);
    });

    it("returns false when the signature is wrong", () => {
      expect(verifySignUrlToken(KEY, EXPIRES, "deadbeefdeadbeefdeadbeefdeadbeef", SECRET)).toBe(
        false,
      );
    });

    it("returns false when the signature is undefined but a secret is configured", () => {
      expect(verifySignUrlToken(KEY, EXPIRES, undefined, SECRET)).toBe(false);
    });

    it("returns false when the key is tampered", () => {
      const sig = signUrlToken(KEY, EXPIRES, SECRET);
      expect(verifySignUrlToken("other-key.jpg", EXPIRES, sig, SECRET)).toBe(false);
    });

    it("returns false when the expires is tampered", () => {
      const sig = signUrlToken(KEY, EXPIRES, SECRET);
      // Attacker tries to extend the expiry by 1 year
      expect(verifySignUrlToken(KEY, EXPIRES + 60 * 60 * 24 * 365, sig, SECRET)).toBe(false);
    });

    it("returns true (dev-mode: no secret) regardless of sig value", () => {
      // When no secret is configured, verification is skipped so unsigned
      // URLs from older adapter code continue to work in local dev.
      expect(verifySignUrlToken(KEY, EXPIRES, undefined, undefined)).toBe(true);
      expect(verifySignUrlToken(KEY, EXPIRES, "any-random-garbage", undefined)).toBe(true);
    });

    it("returns false for a valid sig with the wrong secret", () => {
      const sig = signUrlToken(KEY, EXPIRES, SECRET);
      expect(verifySignUrlToken(KEY, EXPIRES, sig, "wrong-secret")).toBe(false);
    });
  });

  describe("sign + verify round-trip", () => {
    it("a freshly-signed token verifies correctly", () => {
      const expires = Math.floor(Date.now() / 1000) + 3600;
      const sig = signUrlToken(KEY, expires, SECRET);
      expect(verifySignUrlToken(KEY, expires, sig, SECRET)).toBe(true);
    });
  });
});
