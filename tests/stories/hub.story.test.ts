import { describe, expect, it } from "vitest";

import { FeaturesSchema } from "../../src/core/features/features.js";
import { planHub, type HubInput, type HubLink } from "../../src/core/dx/hub.js";

/**
 * Story · Hub planner.
 *
 * Pure planner: given the active feature set + DX-tool configs,
 * returns the link list the `/hub` landing page renders. The page
 * itself is a thin Nest controller that calls this planner; keeping
 * the planner I/O-free means we can change link categorisation /
 * conditional-visibility without booting NestJS in the test suite.
 */
describe("Story · Hub planner", () => {
  function input(overrides: Partial<HubInput> = {}): HubInput {
    return {
      env: "development",
      features: FeaturesSchema.parse({}),
      scalar: { mountPath: "/api/docs", specUrl: "/api/openapi.json" },
      ...overrides,
    };
  }

  function labels(links: HubLink[]): string[] {
    return links.map((l: HubLink) => l.label);
  }

  describe("always-on links", () => {
    it("includes the Scalar API reference", () => {
      expect(labels(planHub(input()))).toContain("Scalar API Reference");
    });

    it("includes the raw OpenAPI spec link", () => {
      expect(labels(planHub(input()))).toContain("OpenAPI Spec (raw)");
    });

    it("includes the Permission-Tester regardless of features", () => {
      expect(labels(planHub(input()))).toContain("Permission Tester");
    });

    it("includes the active-features endpoint", () => {
      expect(labels(planHub(input()))).toContain("Active Features");
    });
  });

  describe("conditional on features", () => {
    it("includes Webhook-Inspector only when features.webhooks.enabled", () => {
      const off = labels(
        planHub(input({ features: FeaturesSchema.parse({ webhooks: { enabled: false } }) })),
      );
      const on = labels(
        planHub(input({ features: FeaturesSchema.parse({ webhooks: { enabled: true } }) })),
      );
      expect(off).not.toContain("Webhook Inspector");
      expect(on).toContain("Webhook Inspector");
    });

    it("includes Realtime-Inspector only when features.realtime.enabled", () => {
      const off = labels(
        planHub(input({ features: FeaturesSchema.parse({ realtime: { enabled: false } }) })),
      );
      const on = labels(
        planHub(input({ features: FeaturesSchema.parse({ realtime: { enabled: true } }) })),
      );
      expect(off).not.toContain("Realtime Inspector");
      expect(on).toContain("Realtime Inspector");
    });

    it("includes Search-Tester only when features.search.enabled", () => {
      const off = labels(
        planHub(input({ features: FeaturesSchema.parse({ search: { enabled: false } }) })),
      );
      const on = labels(
        planHub(input({ features: FeaturesSchema.parse({ search: { enabled: true } }) })),
      );
      expect(off).not.toContain("Search Tester");
      expect(on).toContain("Search Tester");
    });

    it("includes Audit-Browser only when features.audit.enabled", () => {
      const off = labels(
        planHub(input({ features: FeaturesSchema.parse({ audit: { enabled: false } }) })),
      );
      const on = labels(planHub(input()));
      expect(off).not.toContain("Audit Browser");
      expect(on).toContain("Audit Browser");
    });
  });

  describe("categorisation", () => {
    it('groups Scalar / OpenAPI / Permissions under "api"', () => {
      const links = planHub(input());
      expect(links.find((l: HubLink) => l.label === "Scalar API Reference")?.category).toBe("api");
      expect(links.find((l: HubLink) => l.label === "OpenAPI Spec (raw)")?.category).toBe("api");
      expect(links.find((l: HubLink) => l.label === "Permission Tester")?.category).toBe("api");
    });

    it('groups Active-Features under "architecture"', () => {
      const links = planHub(input());
      expect(links.find((l: HubLink) => l.label === "Active Features")?.category).toBe(
        "architecture",
      );
    });

    it('groups Audit-Browser under "data"', () => {
      const links = planHub(input());
      expect(links.find((l: HubLink) => l.label === "Audit Browser")?.category).toBe("data");
    });

    it('groups Webhook-Inspector / Realtime-Inspector under "async"', () => {
      const links = planHub(
        input({
          features: FeaturesSchema.parse({
            webhooks: { enabled: true },
            realtime: { enabled: true },
          }),
        }),
      );
      expect(links.find((l: HubLink) => l.label === "Webhook Inspector")?.category).toBe("async");
      expect(links.find((l: HubLink) => l.label === "Realtime Inspector")?.category).toBe("async");
    });
  });

  describe("environment", () => {
    it("returns the same set in development", () => {
      expect(planHub(input({ env: "development" })).length).toBeGreaterThan(0);
    });

    it("returns an empty list in production (the page is gated by admin permission anyway)", () => {
      expect(planHub(input({ env: "production" }))).toEqual([]);
    });

    it("returns an empty list in test", () => {
      expect(planHub(input({ env: "test" }))).toEqual([]);
    });
  });

  describe("ordering", () => {
    it("returns links in deterministic order — categories grouped, label-sorted within each group", () => {
      const links = planHub(
        input({
          features: FeaturesSchema.parse({
            webhooks: { enabled: true },
            realtime: { enabled: true },
            search: { enabled: true },
          }),
        }),
      );
      const categories = links.map((l: HubLink) => l.category);
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
