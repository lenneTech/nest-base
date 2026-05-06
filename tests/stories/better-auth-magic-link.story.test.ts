import { describe, expect, it } from "vitest";

import { listAuthPluginNames } from "../../src/core/auth/better-auth-plugins.js";
import { FeaturesSchema } from "../../src/core/features/features.js";

/**
 * Story · Better-Auth magicLink plugin (CF.AUTH.07).
 *
 * The PRD's `CF.AUTH.07` requires a feature-gated `magicLink` plugin
 * (5-min signed link sent via email). The plugin enrols into the
 * Better-Auth instance only when `features.magicLink.enabled` is on,
 * and emits the same `"magicLink"` plugin name into
 * `listAuthPluginNames(features)` so the build script and the route
 * audit can reflect it.
 *
 * The plugin's email payload routes through the existing email outbox
 * (CF.EMAIL.05) — so an offline SMTP transport simply queues the
 * link instead of dropping it.
 */
describe("Story · Better-Auth magicLink plugin", () => {
  it("is absent by default (feature defaults to off)", () => {
    const features = FeaturesSchema.parse({});
    expect(listAuthPluginNames(features)).not.toContain("magicLink");
  });

  it("appears in the plugin list when features.magicLink.enabled is true", () => {
    const features = FeaturesSchema.parse({ magicLink: { enabled: true } });
    expect(listAuthPluginNames(features)).toContain("magicLink");
  });

  it("preserves other plugins when magicLink is enabled", () => {
    const features = FeaturesSchema.parse({ magicLink: { enabled: true } });
    const plugins = listAuthPluginNames(features);
    // Default-on plugins remain present.
    expect(plugins).toContain("passkey");
    expect(plugins).toContain("twoFactor");
    expect(plugins).toContain("apiKeys");
  });
});
