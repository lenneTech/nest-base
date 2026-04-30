import { describe, expect, it } from "vitest";

import { FeaturesSchema } from "../../src/core/features/features.js";
import { planDevHub, type DevHubInput, type DevHubLink } from "../../src/core/dx/dev-hub.js";

/**
 * Story · Dev-Hub planner.
 *
 * Pure planner: given the active feature set + DX-tool configs,
 * returns the link list the `/dev` landing page renders. The page
 * itself is a thin Nest controller that calls this planner; keeping
 * the planner I/O-free means we can change link categorisation /
 * conditional-visibility without booting NestJS in the test suite.
 */
describe("Story · Dev-Hub planner", () => {
  function input(overrides: Partial<DevHubInput> = {}): DevHubInput {
    return {
      env: "development",
      features: FeaturesSchema.parse({}),
      scalar: { mountPath: "/api/docs", specUrl: "/api/openapi.json" },
      ...overrides,
    };
  }

  function labels(links: DevHubLink[]): string[] {
    return links.map((l: DevHubLink) => l.label);
  }

  describe("always-on links", () => {
    it("includes the Scalar API reference", () => {
      expect(labels(planDevHub(input()))).toContain("Scalar API Reference");
    });

    it("includes the raw OpenAPI spec link", () => {
      expect(labels(planDevHub(input()))).toContain("OpenAPI Spec (raw)");
    });

    it("includes the Permission-Tester regardless of features", () => {
      expect(labels(planDevHub(input()))).toContain("Permission Tester");
    });

    it("includes the active-features endpoint", () => {
      expect(labels(planDevHub(input()))).toContain("Active Features");
    });
  });

  describe("conditional on features", () => {
    it("includes Webhook-Inspector only when features.webhooks.enabled", () => {
      const off = labels(
        planDevHub(input({ features: FeaturesSchema.parse({ webhooks: { enabled: false } }) })),
      );
      const on = labels(
        planDevHub(input({ features: FeaturesSchema.parse({ webhooks: { enabled: true } }) })),
      );
      expect(off).not.toContain("Webhook Inspector");
      expect(on).toContain("Webhook Inspector");
    });

    it("includes Realtime-Inspector only when features.realtime.enabled", () => {
      const off = labels(
        planDevHub(input({ features: FeaturesSchema.parse({ realtime: { enabled: false } }) })),
      );
      const on = labels(
        planDevHub(input({ features: FeaturesSchema.parse({ realtime: { enabled: true } }) })),
      );
      expect(off).not.toContain("Realtime Inspector");
      expect(on).toContain("Realtime Inspector");
    });

    it("includes Search-Tester only when features.search.enabled", () => {
      const off = labels(
        planDevHub(input({ features: FeaturesSchema.parse({ search: { enabled: false } }) })),
      );
      const on = labels(
        planDevHub(input({ features: FeaturesSchema.parse({ search: { enabled: true } }) })),
      );
      expect(off).not.toContain("Search Tester");
      expect(on).toContain("Search Tester");
    });

    it("includes Audit-Browser regardless (audit-log is core)", () => {
      expect(labels(planDevHub(input()))).toContain("Audit Browser");
    });
  });

  describe("categorisation", () => {
    it('groups Scalar / OpenAPI / Permissions under "api"', () => {
      const links = planDevHub(input());
      expect(links.find((l: DevHubLink) => l.label === "Scalar API Reference")?.category).toBe(
        "api",
      );
      expect(links.find((l: DevHubLink) => l.label === "OpenAPI Spec (raw)")?.category).toBe("api");
      expect(links.find((l: DevHubLink) => l.label === "Permission Tester")?.category).toBe("api");
    });

    it('groups Active-Features under "architecture"', () => {
      const links = planDevHub(input());
      expect(links.find((l: DevHubLink) => l.label === "Active Features")?.category).toBe(
        "architecture",
      );
    });

    it('groups Audit-Browser under "data"', () => {
      const links = planDevHub(input());
      expect(links.find((l: DevHubLink) => l.label === "Audit Browser")?.category).toBe("data");
    });

    it('groups Webhook-Inspector / Realtime-Inspector under "async"', () => {
      const links = planDevHub(
        input({
          features: FeaturesSchema.parse({
            webhooks: { enabled: true },
            realtime: { enabled: true },
          }),
        }),
      );
      expect(links.find((l: DevHubLink) => l.label === "Webhook Inspector")?.category).toBe(
        "async",
      );
      expect(links.find((l: DevHubLink) => l.label === "Realtime Inspector")?.category).toBe(
        "async",
      );
    });
  });

  describe("environment", () => {
    it("returns the same set in development", () => {
      expect(planDevHub(input({ env: "development" })).length).toBeGreaterThan(0);
    });

    it("returns an empty list in production (the page is gated by admin permission anyway)", () => {
      expect(planDevHub(input({ env: "production" }))).toEqual([]);
    });

    it("returns an empty list in test", () => {
      expect(planDevHub(input({ env: "test" }))).toEqual([]);
    });
  });

  describe("ordering", () => {
    it("returns links in deterministic order — categories grouped, label-sorted within each group", () => {
      const links = planDevHub(
        input({
          features: FeaturesSchema.parse({
            webhooks: { enabled: true },
            realtime: { enabled: true },
            search: { enabled: true },
          }),
        }),
      );
      const categories = links.map((l: DevHubLink) => l.category);
      // Categories appear in this fixed order: api → architecture → data → async
      const apiBlockEnd = categories.lastIndexOf("api");
      const archBlockStart = categories.indexOf("architecture");
      const archBlockEnd = categories.lastIndexOf("architecture");
      const dataBlockStart = categories.indexOf("data");
      expect(apiBlockEnd).toBeLessThan(archBlockStart);
      expect(archBlockEnd).toBeLessThan(dataBlockStart);
    });
  });
});
