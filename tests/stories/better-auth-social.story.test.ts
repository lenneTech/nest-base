import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";

/**
 * Story · Better-Auth Social-Login Providers.
 *
 * The factory accepts a `socialProviders` block keyed by provider id
 * (google · github · apple · discord — the Better-Auth providers we
 * surface today). Each entry needs `clientId` + `clientSecret`; the
 * factory wires them straight into Better-Auth's `socialProviders`
 * option so `signInSocial()` accepts those providers at runtime.
 *
 * Validation lives in the factory so misconfigured production envs
 * fail at boot, not at the first user sign-in.
 */
describe("Story · Better-Auth Social-Login", () => {
  function options(auth: ReturnType<typeof buildBetterAuth>): {
    socialProviders?: Record<string, unknown>;
  } {
    return auth.options as unknown as { socialProviders?: Record<string, unknown> };
  }

  it("does not configure social providers when the option is omitted", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(64),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
    });
    const social = options(auth).socialProviders ?? {};
    expect(social.google).toBeUndefined();
    expect(social.github).toBeUndefined();
    expect(social.apple).toBeUndefined();
    expect(social.discord).toBeUndefined();
  });

  it("wires google into Better-Auth options when configured", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(64),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      socialProviders: {
        google: { clientId: "gid", clientSecret: "gsecret" },
      },
    });
    expect(options(auth).socialProviders?.google).toEqual({
      clientId: "gid",
      clientSecret: "gsecret",
    });
  });

  it("wires multiple providers in a single call", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(64),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      socialProviders: {
        google: { clientId: "g", clientSecret: "g" },
        github: { clientId: "gh", clientSecret: "gh" },
        apple: { clientId: "ap", clientSecret: "ap" },
        discord: { clientId: "d", clientSecret: "d" },
      },
    });
    const social = options(auth).socialProviders ?? {};
    expect(Object.keys(social).sort()).toEqual(["apple", "discord", "github", "google"]);
  });

  it("rejects an empty clientId", () => {
    expect(() =>
      buildBetterAuth({
        secret: "a".repeat(64),
        baseUrl: "http://localhost:3000",
        sessionExpiresInSeconds: 60,
        socialProviders: {
          google: { clientId: "", clientSecret: "x" },
        },
      }),
    ).toThrow(/google.*clientId/i);
  });

  it("rejects an empty clientSecret", () => {
    expect(() =>
      buildBetterAuth({
        secret: "a".repeat(64),
        baseUrl: "http://localhost:3000",
        sessionExpiresInSeconds: 60,
        socialProviders: {
          github: { clientId: "x", clientSecret: "" },
        },
      }),
    ).toThrow(/github.*clientSecret/i);
  });

  it("still validates the base invariants (secret length) when social providers are configured", () => {
    expect(() =>
      buildBetterAuth({
        secret: "short",
        baseUrl: "http://localhost:3000",
        sessionExpiresInSeconds: 60,
        socialProviders: { google: { clientId: "x", clientSecret: "x" } },
      }),
    ).toThrow(/secret/i);
  });

  it("coexists with twoFactor and passkey wiring", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(64),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      twoFactor: { issuer: "Acme" },
      passkey: { rpName: "Acme" },
      socialProviders: { google: { clientId: "g", clientSecret: "g" } },
    });
    expect(options(auth).socialProviders?.google).toBeDefined();
    expect(typeof (auth.api as unknown as Record<string, unknown>).enableTwoFactor).toBe(
      "function",
    );
    expect(
      typeof (auth.api as unknown as Record<string, unknown>).generatePasskeyRegistrationOptions,
    ).toBe("function");
  });
});
