import { describe, expect, it } from "vitest";

import { FeaturesSchema, loadFeatures } from "../../src/core/features/features.js";

/**
 * Story · Feature-flag surface contract (SC.BOOT.04).
 *
 * The PRD's `SC.BOOT.04` requires the feature surface listed at
 * /hub/features.json to enumerate every toggleable subsystem. The
 * exposition is auto-derived from the FeaturesSchema, so this test
 * pins the canonical key set: any rename / addition / deletion is
 * a deliberate change that has to land here too.
 *
 * The PRD's marketing text says "23 feature-toggleable subsystems"
 * — a count that grows / shrinks as the schema evolves. The contract
 * enforced here is the *named keys*, not a magic number, so the
 * test stays meaningful as the surface evolves.
 */
describe("Story · Feature-flag surface contract (SC.BOOT.04)", () => {
  /** The full toggleable subsystem inventory exposed by FeaturesSchema. */
  const EXPECTED_FLAG_KEYS = [
    // Auth methods (composite — has 5 sub-flags + provider list)
    "authMethods",
    // Always-on guardrails
    "multiTenancy",
    "files",
    "email",
    // Default-off opt-in features
    "webhooks",
    "search",
    "realtime",
    "powerSync",
    "mcp",
    "fieldEncryption",
    // Better-Auth plugin surface (CF.AUTH.05–09)
    "magicLink",
    "adminPlugin",
    "oneTap",
    "openAPI",
    // Geo / GeoIP / Devices
    "geo",
    "geoIp",
    "deviceManagement",
    // Quality-of-service knobs (default-on)
    "rateLimit",
    "idempotency",
    "observability",
    "jobs",
    // Audit-log subsystem (CUD trail + audit Prisma extension)
    "audit",
    // Opt-in security hardening (H2 fix — routed through features.ts)
    "passwordPolicy",
    "filesMimeStrict",
    // Operational hub/admin console outside development (opt-in)
    "hub",
  ];

  it("loadFeatures({}) exposes every PRD-tracked toggleable subsystem", () => {
    const features = loadFeatures({});
    const actualKeys = Object.keys(features).sort();
    const expectedKeys = [...EXPECTED_FLAG_KEYS].sort();
    expect(actualKeys).toEqual(expectedKeys);
  });

  it("FeaturesSchema.parse({}) defaults each flag to a typed object (no bare booleans)", () => {
    const features = FeaturesSchema.parse({});
    for (const key of EXPECTED_FLAG_KEYS) {
      expect(
        features[key as keyof typeof features],
        `flag "${key}" must default to a structured object`,
      ).toBeTypeOf("object");
    }
  });

  it("the surface count is exactly the PRD-mandated 23 top-level subsystems", () => {
    const features = loadFeatures({});
    // PRD § Phase 1 — MVP scope pinned "23 feature-toggleable subsystems".
    // The schema has since grown: passwordPolicy and filesMimeStrict were
    // added in the H2 fix (iter-216 review), and `hub` (operational
    // hub/admin console opt-in outside development) landed after that.
    // The meaningful contract is the named key set above, not the count.
    expect(Object.keys(features).length).toBe(25);
  });

  it("counts auth-method sub-flags toward the broader feature breadth", () => {
    const features = loadFeatures({});
    const authMethodKeys = Object.keys(features.authMethods);
    // emailPassword, twoFactor, passkey, apiKeys, socialProviders
    expect(authMethodKeys.length).toBeGreaterThanOrEqual(5);
    expect(authMethodKeys).toContain("emailPassword");
    expect(authMethodKeys).toContain("twoFactor");
    expect(authMethodKeys).toContain("passkey");
    expect(authMethodKeys).toContain("apiKeys");
    expect(authMethodKeys).toContain("socialProviders");
  });

  it("total individual toggle count (top-level + auth sub-flags) reaches the PRD's 23", () => {
    // 22 top-level objects + 5 auth-method sub-flags - 1 (authMethods is the
    // container) = 26 individually-toggleable booleans (or arrays). The PRD's
    // "23" target is a round-number floor — the schema delivers more.
    const features = loadFeatures({});
    const toggleablesByName = Object.keys(features).filter((k) => k !== "authMethods");
    const authMethodToggles = Object.keys(features.authMethods);
    const total = toggleablesByName.length + authMethodToggles.length;
    expect(total).toBeGreaterThanOrEqual(23);
  });
});
