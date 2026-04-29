import { describe, expect, it } from "vitest";

import { listAuthPluginNames } from "../../src/core/auth/better-auth-plugins.js";
import { FeaturesSchema } from "../../src/core/features/features.js";

/**
 * Story · Better-Auth plugins
 *
 * The active plugin set is derived from `features.authMethods` so a
 * project that disabled passkey/2fa skips loading their plugins.
 */
describe("Story · Better-Auth plugins", () => {
  it("default features include passkey + twoFactor + apiKeys", () => {
    const features = FeaturesSchema.parse({});
    const plugins = listAuthPluginNames(features);
    expect(plugins).toContain("passkey");
    expect(plugins).toContain("twoFactor");
    expect(plugins).toContain("apiKeys");
  });

  it("disabling passkey removes the passkey plugin", () => {
    const features = FeaturesSchema.parse({ authMethods: { passkey: false } });
    expect(listAuthPluginNames(features)).not.toContain("passkey");
  });

  it("socialProviders plugin only loads when at least one provider is configured", () => {
    const none = FeaturesSchema.parse({});
    expect(listAuthPluginNames(none)).not.toContain("social");
    const some = FeaturesSchema.parse({ authMethods: { socialProviders: ["google"] } });
    expect(listAuthPluginNames(some)).toContain("social");
  });
});
