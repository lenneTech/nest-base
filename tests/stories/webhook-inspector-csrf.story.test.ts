import { describe, expect, it } from "vitest";

import { issueCsrfToken, verifyCsrfToken } from "../../src/core/webhooks/inspector-csrf.js";

/**
 * Story · Inspector CSRF token.
 *
 * Pure HMAC-based stateless CSRF: server signs a random nonce + an
 * issuance timestamp with a process secret. Verifier rejects tampered,
 * malformed, or expired tokens. No session storage — the secret is
 * loaded once at boot from env (or auto-generated for dev).
 */

describe("Story · Inspector CSRF token", () => {
  const SECRET = "test-secret-please-do-not-use-in-prod";

  it("issues a base64url token that verifies with the matching secret", () => {
    const token = issueCsrfToken({ secret: SECRET, now: 1700000000 });
    expect(token.length).toBeGreaterThan(20);
    expect(verifyCsrfToken({ token, secret: SECRET, now: 1700000010, ttlSeconds: 3600 })).toBe(
      true,
    );
  });

  it("rejects tokens signed with a different secret", () => {
    const token = issueCsrfToken({ secret: SECRET, now: 1700000000 });
    expect(
      verifyCsrfToken({ token, secret: "other-secret", now: 1700000010, ttlSeconds: 3600 }),
    ).toBe(false);
  });

  it("rejects expired tokens (now > issuedAt + ttl)", () => {
    const token = issueCsrfToken({ secret: SECRET, now: 1700000000 });
    expect(verifyCsrfToken({ token, secret: SECRET, now: 1700004000, ttlSeconds: 3600 })).toBe(
      false,
    );
  });

  it("rejects malformed tokens", () => {
    expect(verifyCsrfToken({ token: "not-a-token", secret: SECRET, now: 1, ttlSeconds: 60 })).toBe(
      false,
    );
    expect(verifyCsrfToken({ token: "", secret: SECRET, now: 1, ttlSeconds: 60 })).toBe(false);
    expect(verifyCsrfToken({ token: "abc.def", secret: SECRET, now: 1, ttlSeconds: 60 })).toBe(
      false,
    );
  });

  it("rejects tokens with a tampered payload", () => {
    const token = issueCsrfToken({ secret: SECRET, now: 1700000000 });
    const [payload, sig] = token.split(".");
    const tampered = `${payload}x.${sig}`;
    expect(
      verifyCsrfToken({ token: tampered, secret: SECRET, now: 1700000010, ttlSeconds: 3600 }),
    ).toBe(false);
  });

  it("issues a fresh token each call (nonce changes)", () => {
    const a = issueCsrfToken({ secret: SECRET, now: 1700000000 });
    const b = issueCsrfToken({ secret: SECRET, now: 1700000000 });
    expect(a).not.toBe(b);
  });
});
