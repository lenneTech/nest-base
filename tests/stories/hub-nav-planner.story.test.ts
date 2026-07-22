import { describe, expect, it } from "vitest";

import {
  buildHubNavFeatureSnapshot,
  filterPalettePagesForNavSnapshot,
  isHubQuickLinkVisible,
  isNavItemVisibleForNavSnapshot,
  isSpaPathAllowedByNavSnapshot,
  isSpaPathWorkstationOnly,
  NAV_ITEM_FEATURE_REQUIREMENTS,
  SPA_ROUTE_FEATURE_REQUIREMENTS,
  WORKSTATION_SPA_PATH_PREFIXES,
} from "../../src/core/dx/hub-nav-planner.js";
import { loadFeatures } from "../../src/core/features/features.js";
import { NAV_SECTIONS, navSectionsForPortalAccess } from "../../src/core/dx/clients/layout/nav.js";
import type { HubPortalNavFeatures } from "../../src/core/hub/hub-portal-access.js";
import type { ToggleableFeatureKey } from "../../src/core/features/features.js";

describe("Story · Hub nav planner (feature flags)", () => {
  const allOn: HubPortalNavFeatures = {
    multiTenancy: true,
    files: true,
    email: true,
    webhooks: true,
    search: true,
    realtime: true,
    audit: true,
    rateLimit: true,
    jobs: true,
  };
  const allOffSnapshot = (): HubPortalNavFeatures => ({
    multiTenancy: false,
    files: false,
    email: false,
    webhooks: false,
    search: false,
    realtime: false,
    audit: false,
    rateLimit: false,
    jobs: false,
  });

  function snapshotWith(overrides: Partial<HubPortalNavFeatures>): HubPortalNavFeatures {
    return { ...allOn, ...overrides };
  }

  function envFor(key: ToggleableFeatureKey, enabled: boolean): Record<string, string> {
    const envKey = `FEATURE_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}_ENABLED`;
    return { [envKey]: enabled ? "true" : "false" };
  }

  it("buildHubNavFeatureSnapshot exposes every nav-gated toggle", () => {
    expect(buildHubNavFeatureSnapshot(loadFeatures(envFor("webhooks", false)))).toMatchObject({
      webhooks: false,
    });
    expect(buildHubNavFeatureSnapshot(loadFeatures(envFor("audit", false)))).toMatchObject({
      audit: false,
    });
  });

  const gatedNavCases: Array<{
    itemId: string;
    feature: ToggleableFeatureKey;
    path: string;
  }> = [
    { itemId: "tenants", feature: "multiTenancy", path: "/hub/admin/tenants" },
    { itemId: "webhooks", feature: "webhooks", path: "/hub/admin/webhooks" },
    { itemId: "realtime", feature: "realtime", path: "/hub/admin/realtime" },
    { itemId: "audit", feature: "audit", path: "/hub/admin/audit" },
    { itemId: "search", feature: "search", path: "/hub/admin/search" },
    { itemId: "rate-limits", feature: "rateLimit", path: "/hub/admin/rate-limits" },
    { itemId: "files", feature: "files", path: "/hub/files" },
    { itemId: "jobs", feature: "jobs", path: "/hub/jobs" },
    { itemId: "cron", feature: "jobs", path: "/hub/cron" },
    { itemId: "email-outbox", feature: "email", path: "/hub/email-outbox" },
    { itemId: "emails", feature: "email", path: "/hub/emails" },
  ];

  it.each(gatedNavCases)(
    "hides $itemId nav + blocks $path when $feature is off",
    ({ itemId, feature, path }) => {
      const off = snapshotWith({ [feature]: false } as Partial<HubPortalNavFeatures>);
      expect(isNavItemVisibleForNavSnapshot(itemId, off)).toBe(false);
      expect(isNavItemVisibleForNavSnapshot(itemId, allOn)).toBe(true);
      expect(isSpaPathAllowedByNavSnapshot(path, off)).toBe(false);
      expect(isSpaPathAllowedByNavSnapshot(`${path}/detail`, off)).toBe(false);
      expect(isSpaPathAllowedByNavSnapshot(path, allOn)).toBe(true);
    },
  );

  it("keeps always-on nav items visible when all gated features are off", () => {
    const off = allOffSnapshot();
    for (const id of ["hub", "users", "diagnostics", "scalar", "permissions"]) {
      expect(isNavItemVisibleForNavSnapshot(id, off)).toBe(true);
    }
    expect(isSpaPathAllowedByNavSnapshot("/hub/admin/users", off)).toBe(true);
    expect(isSpaPathAllowedByNavSnapshot("/hub/diagnostics", off)).toBe(true);
  });

  it("filters Admin nav sections when multiTenancy is off", () => {
    const sections = navSectionsForPortalAccess({
      hub: true,
      tenantAdmin: true,
      navFeatures: snapshotWith({ multiTenancy: false }),
      workstation: true,
    });
    const admin = sections.find((s) => s.title === "Admin");
    expect(admin?.items.some((i) => i.id === "tenants")).toBe(false);
    expect(admin?.items.some((i) => i.id === "users")).toBe(true);
  });

  it("leaves full NAV_SECTIONS when all features on and portal access allows all", () => {
    expect(
      navSectionsForPortalAccess({
        hub: true,
        tenantAdmin: true,
        navFeatures: allOn,
        workstation: true,
      }),
    ).toEqual(NAV_SECTIONS);
  });

  it("isHubQuickLinkVisible hides gated admin links but keeps /api/docs", () => {
    const off = snapshotWith({ webhooks: false, multiTenancy: false });
    expect(isHubQuickLinkVisible("/hub/admin/webhooks", off)).toBe(false);
    expect(isHubQuickLinkVisible("/hub/admin/tenants", off)).toBe(false);
    expect(isHubQuickLinkVisible("/api/docs", off)).toBe(true);
    expect(isHubQuickLinkVisible("/errors", off)).toBe(true);
  });

  it("filterPalettePagesForNavSnapshot drops gated palette entries", () => {
    const pages = [
      {
        id: "webhooks",
        title: "Webhooks",
        href: "/hub/admin/webhooks",
        aliases: [],
        category: "Admin",
      },
      { id: "hub", title: "Hub", href: "/hub", aliases: [], category: "Overview" },
    ];
    const filtered = filterPalettePagesForNavSnapshot(pages, snapshotWith({ webhooks: false }));
    expect(filtered.map((p) => p.id)).toEqual(["hub"]);
  });

  it("NAV_ITEM_FEATURE_REQUIREMENTS keys match SPA route prefixes", () => {
    for (const [itemId, feature] of Object.entries(NAV_ITEM_FEATURE_REQUIREMENTS)) {
      const route = SPA_ROUTE_FEATURE_REQUIREMENTS.find((r) => r.feature === feature);
      expect(route, `nav item "${itemId}" feature "${feature}"`).toBeTruthy();
    }
  });
});

describe("Story · Hub nav planner (workstation tier)", () => {
  // Pages whose DATA endpoints assert the workstation surface tier
  // (dev-only forever) — mirrors the #186 tier table.
  const workstationPaths = [
    "/hub/coverage",
    "/hub/tests",
    "/hub/migrations",
    "/hub/erd",
    "/hub/emails",
    "/hub/emails/templates",
    "/hub/email-preview",
    "/hub/email-builder",
    "/hub/files",
    "/hub/files/nested/dir",
    "/hub/admin/permissions/test",
    "/hub/admin/search",
    "/hub/admin/search/anything",
  ];

  // Operator-console pages: their data endpoints are operational tier
  // and must stay reachable on an opted-in deployment.
  const operationalPaths = [
    "/hub",
    "/hub/diagnostics",
    "/hub/features",
    "/hub/brand",
    "/hub/logs",
    "/hub/traces",
    "/hub/queries",
    "/hub/jobs",
    "/hub/cron",
    "/hub/email-outbox",
    "/hub/routes",
    "/hub/json",
    "/hub/postgrest-parse",
    "/hub/admin/users",
    "/hub/admin/permissions",
    "/hub/admin/rate-limits",
  ];

  it.each(workstationPaths.map((path) => ({ path })))(
    "$path is a workstation-only SPA path",
    ({ path }) => {
      expect(isSpaPathWorkstationOnly(path)).toBe(true);
    },
  );

  it.each(operationalPaths.map((path) => ({ path })))(
    "$path stays an operational SPA path",
    ({ path }) => {
      expect(isSpaPathWorkstationOnly(path)).toBe(false);
    },
  );

  it("every workstation path prefix is covered by the exported list", () => {
    expect(WORKSTATION_SPA_PATH_PREFIXES.length).toBeGreaterThan(0);
    for (const prefix of WORKSTATION_SPA_PATH_PREFIXES) {
      expect(isSpaPathWorkstationOnly(prefix), prefix).toBe(true);
    }
  });

  it("nav tier tags agree with the path classification (cross-lock)", () => {
    for (const item of NAV_SECTIONS.flatMap((s) => s.items)) {
      if (item.href.startsWith("http")) {
        // External links (Prisma Studio → the developer's localhost)
        // are tagged by hand — the path classifier cannot see them.
        continue;
      }
      expect(isSpaPathWorkstationOnly(item.href), `nav item "${item.id}"`).toBe(
        item.tier === "workstation",
      );
    }
  });
});
