import { describe, expect, it } from "vitest";

import {
  FEATURE_CATALOG,
  isFeatureActive,
  summarizeFeatures,
} from "../../src/core/dx/feature-catalog.js";
import { loadFeatures } from "../../src/core/features/features.js";

describe("Story · Feature-Catalog", () => {
  it("listet alle 14 toggleable Features mit Beschreibung + ENV-Key", () => {
    expect(FEATURE_CATALOG).toHaveLength(14);
    for (const meta of FEATURE_CATALOG) {
      expect(meta.label).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(meta.envKey).toMatch(/^FEATURE_[A-Z_]+_ENABLED$/);
      expect(meta.category).toBeTruthy();
      expect(meta.exposes.length).toBeGreaterThan(0);
    }
  });

  it("hat keine Duplikate bei keys oder envKeys", () => {
    const keys = FEATURE_CATALOG.map((f) => f.key);
    const envs = FEATURE_CATALOG.map((f) => f.envKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(envs).size).toBe(envs.length);
  });

  it("isFeatureActive liest enabled-Flag korrekt aus", () => {
    const def = loadFeatures({});
    expect(isFeatureActive(def, "rateLimit")).toBe(true);
    expect(isFeatureActive(def, "webhooks")).toBe(false);
    const allOn = loadFeatures({ FEATURE_WEBHOOKS_ENABLED: "true" });
    expect(isFeatureActive(allOn, "webhooks")).toBe(true);
  });

  it("summarizeFeatures zählt aktiv/total korrekt", () => {
    const def = loadFeatures({});
    const sum = summarizeFeatures(def);
    expect(sum.total).toBe(14);
    expect(sum.active + sum.available).toBe(14);
    expect(sum.active).toBeGreaterThan(0);
    expect(sum.active).toBeLessThan(sum.total);
  });
});
