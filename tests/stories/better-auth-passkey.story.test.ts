import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";

/**
 * Story · Better-Auth Passkey (PLAN.md §4.1 + §32 Phase 6).
 *
 * The factory accepts an optional `passkey: { rpName, rpID? }` block.
 * When present, `@better-auth/passkey` is wired in and the resulting
 * instance exposes the five WebAuthn endpoints — generate-register,
 * verify-registration, verify-authentication, list-user-passkeys,
 * delete-passkey. When absent the plugin stays unloaded.
 *
 * `rpID` defaults to the host of `baseUrl` (PLAN.md §4.1: "Passkey/
 * WebAuthn — auto-detection aus BASE_URL"); `origin` to baseUrl
 * itself. Both can be overridden for production multi-domain setups.
 */
describe("Story · Better-Auth Passkey", () => {
  function api(auth: ReturnType<typeof buildBetterAuth>): Record<string, unknown> {
    return auth.api as unknown as Record<string, unknown>;
  }

  it("does not expose passkey endpoints when passkey option is omitted", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
    });
    expect(api(auth).generatePasskeyRegistrationOptions).toBeUndefined();
    expect(api(auth).verifyPasskeyRegistration).toBeUndefined();
    expect(api(auth).verifyPasskeyAuthentication).toBeUndefined();
    expect(api(auth).listPasskeys).toBeUndefined();
    expect(api(auth).deletePasskey).toBeUndefined();
  });

  it("wires the passkey plugin and exposes the five WebAuthn endpoints when configured", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      passkey: { rpName: "Acme" },
    });
    expect(typeof api(auth).generatePasskeyRegistrationOptions).toBe("function");
    expect(typeof api(auth).verifyPasskeyRegistration).toBe("function");
    expect(typeof api(auth).verifyPasskeyAuthentication).toBe("function");
    expect(typeof api(auth).listPasskeys).toBe("function");
    expect(typeof api(auth).deletePasskey).toBe("function");
  });

  it("rejects an empty rpName (WebAuthn requires a relying-party label)", () => {
    expect(() =>
      buildBetterAuth({
        secret: "a".repeat(32),
        baseUrl: "http://localhost:3000",
        sessionExpiresInSeconds: 60,
        passkey: { rpName: "" },
      }),
    ).toThrow(/rpName/i);
  });

  it("rejects an explicit empty rpID", () => {
    expect(() =>
      buildBetterAuth({
        secret: "a".repeat(32),
        baseUrl: "http://localhost:3000",
        sessionExpiresInSeconds: 60,
        passkey: { rpName: "Acme", rpID: "" },
      }),
    ).toThrow(/rpID/i);
  });

  it("still validates the base invariants (secret length) when passkey is enabled", () => {
    expect(() =>
      buildBetterAuth({
        secret: "short",
        baseUrl: "http://localhost:3000",
        sessionExpiresInSeconds: 60,
        passkey: { rpName: "Acme" },
      }),
    ).toThrow(/secret/i);
  });

  it("coexists with twoFactor — both plugins can be wired together", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      twoFactor: { issuer: "Acme" },
      passkey: { rpName: "Acme" },
    });
    expect(typeof api(auth).enableTwoFactor).toBe("function");
    expect(typeof api(auth).generatePasskeyRegistrationOptions).toBe("function");
  });
});
