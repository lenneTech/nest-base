import { describe, expect, it } from "vitest";

import { listAuthPluginNames } from "../../src/core/auth/better-auth-plugins.js";
import { FeaturesSchema } from "../../src/core/features/features.js";

/**
 * Story · Better-Auth plugin flags (CF.AUTH.05, .06, .08, .09).
 *
 * The PRD's `CF.AUTH.05–09` require feature-gated plugins for:
 *   - admin (impersonation, listUsers, setRole, banUser)
 *   - organization (multi-org + member roles + invites)
 *   - oneTap (Google chooser)
 *   - openAPI (auto-spec at /auth/reference)
 *
 * Each plugin contributes a name to `listAuthPluginNames(features)`
 * only when its corresponding feature flag is on, so the route audit
 * and the plugin-mount step both reflect the chosen surface.
 *
 * The plugins themselves are wired into the Better-Auth instance by
 * the factory (`buildBetterAuth`) at boot — this slice owns the
 * feature-flag → plugin-name mapping.
 */
describe("Story · Better-Auth plugin flags", () => {
  describe("admin plugin", () => {
    it("is absent by default", () => {
      const features = FeaturesSchema.parse({});
      expect(listAuthPluginNames(features)).not.toContain("admin");
    });

    it("appears when features.adminPlugin.enabled is true", () => {
      const features = FeaturesSchema.parse({ adminPlugin: { enabled: true } });
      expect(listAuthPluginNames(features)).toContain("admin");
    });
  });

  describe("organization plugin (gated by multiTenancy)", () => {
    it("is present by default (tenancy ON since issue #118)", () => {
      const features = FeaturesSchema.parse({});
      expect(listAuthPluginNames(features)).toContain("organization");
    });

    it("is absent when features.multiTenancy.enabled is false", () => {
      const features = FeaturesSchema.parse({ multiTenancy: { enabled: false } });
      expect(listAuthPluginNames(features)).not.toContain("organization");
    });

    it("appears when features.multiTenancy.enabled is true", () => {
      const features = FeaturesSchema.parse({ multiTenancy: { enabled: true } });
      expect(listAuthPluginNames(features)).toContain("organization");
    });
  });

  describe("oneTap plugin", () => {
    it("is absent by default", () => {
      const features = FeaturesSchema.parse({});
      expect(listAuthPluginNames(features)).not.toContain("oneTap");
    });

    it("appears when features.oneTap.enabled is true", () => {
      const features = FeaturesSchema.parse({ oneTap: { enabled: true } });
      expect(listAuthPluginNames(features)).toContain("oneTap");
    });
  });

  describe("openAPI plugin", () => {
    it("is absent by default", () => {
      const features = FeaturesSchema.parse({});
      expect(listAuthPluginNames(features)).not.toContain("openAPI");
    });

    it("appears when features.openAPI.enabled is true", () => {
      const features = FeaturesSchema.parse({ openAPI: { enabled: true } });
      expect(listAuthPluginNames(features)).toContain("openAPI");
    });
  });

  it("all four plugins enabled simultaneously", () => {
    const features = FeaturesSchema.parse({
      adminPlugin: { enabled: true },
      multiTenancy: { enabled: true },
      oneTap: { enabled: true },
      openAPI: { enabled: true },
    });
    const plugins = listAuthPluginNames(features);
    expect(plugins).toContain("admin");
    expect(plugins).toContain("organization");
    expect(plugins).toContain("oneTap");
    expect(plugins).toContain("openAPI");
  });

  it("default-enabled plugins remain present alongside the new ones", () => {
    const features = FeaturesSchema.parse({
      adminPlugin: { enabled: true },
      multiTenancy: { enabled: true },
    });
    const plugins = listAuthPluginNames(features);
    // Default-on Better-Auth plugins survive.
    expect(plugins).toContain("passkey");
    expect(plugins).toContain("twoFactor");
    expect(plugins).toContain("apiKeys");
  });
});
