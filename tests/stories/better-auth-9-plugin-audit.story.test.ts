import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";
import { listAuthPluginNames } from "../../src/core/auth/better-auth-plugins.js";
import { FeaturesSchema } from "../../src/core/features/features.js";

/**
 * Story · 9 Better-Auth plugins audit (SC.BOOT.06 + SC.BOOT.07).
 *
 * The PRD's `SC.BOOT.06` requires that all 9 Better-Auth plugins are
 * mountable when their respective feature flags are on. `SC.BOOT.07`
 * mirrors that with the negative case: when the feature flag is off,
 * the plugin name MUST NOT appear in `listAuthPluginNames()`.
 *
 * The 9 plugins per the PRD are:
 *   1. jwt + JWKS              — always-on (delivered via authMethods)
 *   2. twoFactor (TOTP)        — gated by features.authMethods.twoFactor
 *   3. passkey (WebAuthn)      — gated by features.authMethods.passkey
 *   4. admin (impersonation)   — gated by features.adminPlugin (CF.AUTH.05 iter-41)
 *   5. organization            — gated by features.multiTenancy (tenancy)
 *   6. magicLink (5-min link)  — gated by features.magicLink
 *   7. oneTap (Google chooser) — gated by features.oneTap
 *   8. openAPI (auth/reference) — gated by features.openAPI
 *   9. social (Google/GitHub/Apple/Discord) — gated by features.authMethods.socialProviders
 *
 * Plus `apiKeys` and `emailVerification` which are framework-derived
 * additional plugin slots. The test treats the 9 PRD-named slots as
 * the authoritative inventory.
 */
describe("Story · 9 Better-Auth plugins audit", () => {
  const ALL_NINE_OFF: Record<string, unknown> = {
    authMethods: {
      emailPassword: false,
      twoFactor: false,
      passkey: false,
      apiKeys: false,
      socialProviders: [],
    },
    email: { enabled: false },
    magicLink: { enabled: false },
    adminPlugin: { enabled: false },
    multiTenancy: { enabled: false },
    oneTap: { enabled: false },
    openAPI: { enabled: false },
  };

  const ALL_NINE_ON: Record<string, unknown> = {
    authMethods: {
      emailPassword: true,
      twoFactor: true,
      passkey: true,
      apiKeys: true,
      socialProviders: ["google"],
    },
    email: { enabled: true },
    magicLink: { enabled: true },
    adminPlugin: { enabled: true },
    multiTenancy: { enabled: true },
    oneTap: { enabled: true },
    openAPI: { enabled: true },
  };

  describe("SC.BOOT.06 — all 9 plugins mountable when flags are on", () => {
    it("twoFactor plugin appears", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("twoFactor");
    });

    it("passkey plugin appears", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("passkey");
    });

    it("admin plugin appears", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("admin");
    });

    it("organization plugin appears", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("organization");
    });

    it("magicLink plugin appears", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("magicLink");
    });

    it("oneTap plugin appears", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("oneTap");
    });

    it("openAPI plugin appears", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("openAPI");
    });

    it("social plugin appears (when at least one provider configured)", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("social");
    });

    it("emailVerification plugin appears (delivered via the email outbox)", () => {
      const features = FeaturesSchema.parse(ALL_NINE_ON);
      expect(listAuthPluginNames(features)).toContain("emailVerification");
    });
  });

  describe("SC.BOOT.07 — all 9 plugins absent when flags are off", () => {
    it("twoFactor / passkey / apiKeys / social removed from authMethods", () => {
      const features = FeaturesSchema.parse(ALL_NINE_OFF);
      const plugins = listAuthPluginNames(features);
      expect(plugins).not.toContain("twoFactor");
      expect(plugins).not.toContain("passkey");
      expect(plugins).not.toContain("apiKeys");
      expect(plugins).not.toContain("social");
    });

    it("admin / organization / magicLink / oneTap / openAPI absent", () => {
      const features = FeaturesSchema.parse(ALL_NINE_OFF);
      const plugins = listAuthPluginNames(features);
      expect(plugins).not.toContain("admin");
      expect(plugins).not.toContain("organization");
      expect(plugins).not.toContain("magicLink");
      expect(plugins).not.toContain("oneTap");
      expect(plugins).not.toContain("openAPI");
    });

    it("emailVerification absent when features.email.enabled is off", () => {
      const features = FeaturesSchema.parse(ALL_NINE_OFF);
      const plugins = listAuthPluginNames(features);
      expect(plugins).not.toContain("emailVerification");
    });
  });

  /**
   * SC.BOOT.06 hard-promise: the previous block only asserts the
   * inventory helper. The real PRD contract is that the plugin
   * actually mounts in `betterAuth(...).api`, so a live call to
   * `/api/auth/<plugin-route>` would not 404.
   *
   * `buildBetterAuth(input)` is the single source of truth for
   * plugin registration. A plugin's mount surfaces as additional
   * keys on `auth.api`. We assert each plugin contributes at
   * least one named endpoint when its option is supplied.
   */
  describe("SC.BOOT.06 — buildBetterAuth() mounts plugin endpoints (factory contract)", () => {
    const BASE_INPUT = {
      secret: "test-secret-that-is-at-least-64-characters-long-for-testing-purposes",
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 3600,
    } as const;

    it("twoFactor option mounts twoFactor endpoints on auth.api", () => {
      const auth = buildBetterAuth({ ...BASE_INPUT, twoFactor: { issuer: "TestApp" } });
      const apiKeys = Object.keys(auth.api);
      expect(apiKeys.some((k) => k.toLowerCase().includes("twofactor"))).toBe(true);
    });

    it("jwtPlugin option mounts a JWKS endpoint on auth.api", () => {
      const auth = buildBetterAuth({ ...BASE_INPUT, jwtPlugin: { audience: "test" } });
      const apiKeys = Object.keys(auth.api);
      expect(apiKeys.some((k) => k.toLowerCase().includes("jwks") || k.includes("jwt"))).toBe(true);
    });

    it("passkey option mounts passkey endpoints on auth.api", () => {
      const auth = buildBetterAuth({ ...BASE_INPUT, passkey: { rpName: "TestApp" } });
      const apiKeys = Object.keys(auth.api);
      expect(apiKeys.some((k) => k.toLowerCase().includes("passkey"))).toBe(true);
    });

    it("magicLink option mounts a sign-in/magic-link endpoint", () => {
      const auth = buildBetterAuth({
        ...BASE_INPUT,
        magicLink: {
          sendMagicLink: async () => {
            // SDK-test stub — wire through EmailService in production.
          },
        },
      });
      const apiKeys = Object.keys(auth.api);
      expect(apiKeys.some((k) => k.toLowerCase().includes("magic"))).toBe(true);
    });

    it("adminPlugin option mounts admin endpoints", () => {
      const auth = buildBetterAuth({ ...BASE_INPUT, adminPlugin: { adminRoles: ["admin"] } });
      const apiKeys = Object.keys(auth.api);
      // Admin plugin exposes user management + impersonation routes.
      expect(
        apiKeys.some(
          (k) =>
            k.toLowerCase().includes("admin") ||
            k.toLowerCase().includes("impersonate") ||
            k.toLowerCase().includes("ban"),
        ),
      ).toBe(true);
    });

    it("organization option mounts organization endpoints", () => {
      const auth = buildBetterAuth({ ...BASE_INPUT, organization: {} });
      const apiKeys = Object.keys(auth.api);
      expect(apiKeys.some((k) => k.toLowerCase().includes("organization"))).toBe(true);
    });

    it("oneTap option mounts a one-tap endpoint", () => {
      const auth = buildBetterAuth({
        ...BASE_INPUT,
        oneTap: { clientId: "test-client.apps.googleusercontent.com" },
      });
      const apiKeys = Object.keys(auth.api);
      expect(
        apiKeys.some(
          (k) => k.toLowerCase().includes("onetap") || k.toLowerCase().includes("one-tap"),
        ),
      ).toBe(true);
    });

    it("openAPI option mounts a reference / openapi endpoint", () => {
      const auth = buildBetterAuth({ ...BASE_INPUT, openAPI: {} });
      const apiKeys = Object.keys(auth.api);
      expect(
        apiKeys.some(
          (k) =>
            k.toLowerCase().includes("openapi") ||
            k.toLowerCase().includes("reference") ||
            k.toLowerCase().includes("schema"),
        ),
      ).toBe(true);
    });
  });

  describe("SC.BOOT.07 — buildBetterAuth() factory does NOT mount plugin endpoints when options omitted", () => {
    const BASE_INPUT = {
      secret: "test-secret-that-is-at-least-64-characters-long-for-testing-purposes",
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 3600,
    } as const;

    it("auth.api lacks twofactor / passkey / magic / admin / organization / onetap when options omitted", () => {
      const auth = buildBetterAuth(BASE_INPUT);
      const apiKeys = Object.keys(auth.api).map((k) => k.toLowerCase());
      const FORBIDDEN_FRAGMENTS = [
        "twofactor",
        "passkey",
        "magic",
        "admin",
        "organization",
        "onetap",
        "one-tap",
      ];
      for (const fragment of FORBIDDEN_FRAGMENTS) {
        expect(
          apiKeys.some((k) => k.includes(fragment)),
          `expected no '${fragment}' endpoint on baseline auth.api but found ${apiKeys.filter((k) => k.includes(fragment)).join(", ")}`,
        ).toBe(false);
      }
    });
  });
});
