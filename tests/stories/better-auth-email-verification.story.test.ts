import { describe, expect, it } from "vitest";

import {
  generateVerificationToken,
  verificationLinkUrl,
  isVerificationTokenExpired,
} from "../../src/core/auth/email-verification.js";

/**
 * Story · Better-Auth email verification
 *
 * Verification token generator + expiry guard + safe link builder.
 * Better-Auth's email-verification plugin is configured next slice; the
 * helpers here pin the link format and the token entropy.
 */
describe("Story · Email verification", () => {
  it("generates a 32-byte hex token (256 bits of entropy)", () => {
    const token = generateVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("builds an absolute verification link with the token in a query param", () => {
    const url = verificationLinkUrl({ baseUrl: "https://api.example.com", token: "abc" });
    expect(url).toBe("https://api.example.com/api/auth/verify-email?token=abc");
  });

  it("rejects baseUrls without scheme", () => {
    expect(() => verificationLinkUrl({ baseUrl: "example.com", token: "abc" })).toThrow();
  });

  it("treats tokens older than the configured TTL as expired", () => {
    const issuedAt = new Date(Date.now() - 60 * 60 * 1000 - 1);
    expect(isVerificationTokenExpired({ issuedAt, ttlSeconds: 60 * 60 })).toBe(true);
    const fresh = new Date();
    expect(isVerificationTokenExpired({ issuedAt: fresh, ttlSeconds: 60 * 60 })).toBe(false);
  });
});
