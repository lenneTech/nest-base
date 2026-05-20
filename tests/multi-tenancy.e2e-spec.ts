import { describe, expect, it } from "vitest";

import { FeaturesSchema } from "../src/core/features/features.js";

/**
 * Multi-tenancy feature defaults — session org + optional Postgres RLS.
 */
describe("Multi-tenancy · feature defaults", () => {
  it("enables organizations and RLS by default", () => {
    const features = FeaturesSchema.parse({});
    expect(features.multiTenancy.enabled).toBe(true);
    expect(features.multiTenancy.rls).toBe(true);
  });

  it("can disable tenancy via FEATURE_MULTI_TENANCY_ENABLED=false", () => {
    const features = FeaturesSchema.parse({ multiTenancy: { enabled: false } });
    expect(features.multiTenancy.enabled).toBe(false);
  });
});
