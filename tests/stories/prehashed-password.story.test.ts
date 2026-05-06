import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";
import { PRE_HASH_PREFIX, isPreHashedSha256 } from "../../src/core/auth/prehashed-password.js";

/**
 * Story · Pre-hashed SHA-256 password bypass (issue #100).
 *
 * When a trusted SDK client hashes the password locally before
 * transmission it sends the value as `sha256:<64-char-lowercase-hex>`.
 * The server's character-class entropy check would otherwise reject the
 * hex digest (low diversity despite 64 chars). The prefix sentinel lets
 * the `password.hash` hook detect this case and skip the policy check
 * while still applying the server's own scrypt hash on top.
 *
 * Two layers covered:
 *   1. `isPreHashedSha256(value)` — pure shape detector.
 *   2. Integration: the `buildBetterAuth` `password.hash` hook accepts
 *      a valid sentinel but still rejects a plaintext weak password.
 */
describe("Story · isPreHashedSha256 (pre-hashed password shape detector)", () => {
  it("accepts a valid sha256-prefixed 64-char lowercase hex string", () => {
    expect(isPreHashedSha256(`sha256:${"a".repeat(64)}`)).toBe(true);
  });

  it("rejects uppercase hex digits — the sentinel requires lowercase", () => {
    expect(isPreHashedSha256(`sha256:${"A".repeat(64)}`)).toBe(false);
  });

  it("rejects a hex digest that is one char too short (63 hex chars)", () => {
    expect(isPreHashedSha256(`sha256:${"a".repeat(63)}`)).toBe(false);
  });

  it("rejects a raw 64-char hex string without the sha256: prefix", () => {
    expect(isPreHashedSha256("a".repeat(64))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isPreHashedSha256("")).toBe(false);
  });

  it("exports the PRE_HASH_PREFIX constant as 'sha256:'", () => {
    expect(PRE_HASH_PREFIX).toBe("sha256:");
  });

  it("rejects a hex digest that is one char too long (65 hex chars)", () => {
    expect(isPreHashedSha256(`sha256:${"a".repeat(65)}`)).toBe(false);
  });

  it("rejects mixed-case hex digits", () => {
    expect(isPreHashedSha256(`sha256:${"aB".repeat(32)}`)).toBe(false);
  });
});

describe("Story · buildBetterAuth password.hash hook — pre-hashed bypass (issue #100)", () => {
  it("resolves without throwing when password carries the sha256: sentinel", async () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      passwordPolicy: { minEntropyBits: 50 },
    });

    // Access the hash function via the Better-Auth options object.
    const hashFn = auth.options.emailAndPassword?.password?.hash;
    expect(hashFn).toBeDefined();

    const validSentinel = `sha256:${"a".repeat(64)}`;
    // Should resolve to a non-empty hash string without throwing.
    const result = await hashFn!(validSentinel);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("rejects a short plaintext password with a PasswordPolicyError when policy is configured", async () => {
    const { PasswordPolicyError } = await import("../../src/core/auth/password-policy.js");

    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      passwordPolicy: { minEntropyBits: 50 },
    });

    const hashFn = auth.options.emailAndPassword?.password?.hash;
    expect(hashFn).toBeDefined();

    // "abc" has far too little entropy to pass a 50-bit floor.
    await expect(hashFn!("abc")).rejects.toBeInstanceOf(PasswordPolicyError);
  });
});
