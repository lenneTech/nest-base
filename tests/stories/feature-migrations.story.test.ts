import { describe, expect, it } from "vitest";

import { FeaturesSchema } from "../../src/core/features/features.js";
import {
  planFeatureMigrationSync,
  type FeatureMigrationDir,
} from "../../src/core/setup/feature-migrations.js";

/**
 * Story · Feature-gated migration sync planner.
 *
 * Pure function: given the resolved features and a list of available
 * `<feature>/<migration-dir>` pairs from disk, return the set of
 * migration directories to materialise in `prisma/migrations/` and
 * the set to skip. The runner copies files; the planner decides.
 */
describe("Story · planFeatureMigrationSync", () => {
  const available: FeatureMigrationDir[] = [
    { feature: "geo", name: "20260428000200_postgis_extension" },
    { feature: "geo", name: "20260428000300_geo_gist_indexes" },
  ];

  it("syncs every available migration when the feature is enabled", () => {
    const features = FeaturesSchema.parse({ geo: { enabled: true } });
    const plan = planFeatureMigrationSync({ features, available });

    expect(plan.sync).toHaveLength(2);
    expect(plan.skipped).toHaveLength(0);

    expect(plan.sync[0]).toMatchObject({
      feature: "geo",
      name: "20260428000200_postgis_extension",
      fromRelative: "prisma/features/geo/migrations/20260428000200_postgis_extension",
      toRelative: "prisma/migrations/20260428000200_postgis_extension",
    });
  });

  it("skips every available migration when the feature is disabled", () => {
    const features = FeaturesSchema.parse({ geo: { enabled: false } });
    const plan = planFeatureMigrationSync({ features, available });

    expect(plan.sync).toHaveLength(0);
    expect(plan.skipped).toHaveLength(2);
  });

  it("returns empty plans when no migrations are available", () => {
    const features = FeaturesSchema.parse({ geo: { enabled: true } });
    const plan = planFeatureMigrationSync({ features, available: [] });

    expect(plan.sync).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
  });

  it("orders sync entries lexicographically by name (= timestamp prefix)", () => {
    const features = FeaturesSchema.parse({ geo: { enabled: true } });
    const unordered: FeatureMigrationDir[] = [
      { feature: "geo", name: "20260428000300_geo_gist_indexes" },
      { feature: "geo", name: "20260428000200_postgis_extension" },
    ];
    const plan = planFeatureMigrationSync({ features, available: unordered });

    expect(plan.sync.map((s) => s.name)).toEqual([
      "20260428000200_postgis_extension",
      "20260428000300_geo_gist_indexes",
    ]);
  });

  it("treats unknown features as disabled", () => {
    const features = FeaturesSchema.parse({});
    const plan = planFeatureMigrationSync({
      features,
      available: [{ feature: "made-up", name: "20990101000000_nope" }],
    });

    expect(plan.sync).toHaveLength(0);
    expect(plan.skipped).toHaveLength(1);
  });
});
