import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";

/**
 * Story · Better-Auth Two-Factor.
 *
 * The factory accepts an optional `twoFactor: { issuer }` block. When
 * present, Better-Auth's `twoFactor` plugin is wired into the options
 * and the resulting instance exposes the three TOTP API endpoints —
 * enable / verifyTotp / disable. When absent, the auth instance stays
 * 2FA-free (so projects opting out via feature flags pay zero cost).
 *
 * Endpoints are validated through `auth.api.*` rather than through the
 * HTTP handler so the suite stays DB-free; live route exercise lives
 * in the integration e2e once a Prisma adapter is wired.
 */
describe("Story · Better-Auth Two-Factor", () => {
  function api(auth: ReturnType<typeof buildBetterAuth>): Record<string, unknown> {
    return auth.api as unknown as Record<string, unknown>;
  }

  it("does not expose two-factor endpoints when twoFactor option is omitted", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(64),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
    });
    expect(api(auth).enableTwoFactor).toBeUndefined();
    expect(api(auth).verifyTOTP).toBeUndefined();
    expect(api(auth).disableTwoFactor).toBeUndefined();
  });

  it("wires the twoFactor plugin and exposes the three TOTP endpoints when configured", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(64),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      twoFactor: { issuer: "TestApp" },
    });
    expect(typeof api(auth).enableTwoFactor).toBe("function");
    expect(typeof api(auth).verifyTOTP).toBe("function");
    expect(typeof api(auth).disableTwoFactor).toBe("function");
  });

  it("rejects an empty issuer (TOTP requires a non-empty issuer label)", () => {
    expect(() =>
      buildBetterAuth({
        secret: "a".repeat(64),
        baseUrl: "http://localhost:3000",
        sessionExpiresInSeconds: 60,
        twoFactor: { issuer: "" },
      }),
    ).toThrow(/issuer/i);
  });

  it("still validates the base invariants (secret length) when twoFactor is enabled", () => {
    expect(() =>
      buildBetterAuth({
        secret: "short",
        baseUrl: "http://localhost:3000",
        sessionExpiresInSeconds: 60,
        twoFactor: { issuer: "TestApp" },
      }),
    ).toThrow(/secret/i);
  });
});
