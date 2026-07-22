import { describe, expect, it } from "vitest";

import { buildHubNavFeatureSnapshot } from "../../src/core/dx/hub-nav-planner.js";
import { loadFeatures } from "../../src/core/features/features.js";
import type { HubPortalNavFeatures } from "../../src/core/hub/hub-portal-access.js";
import {
  ADMIN_NAV_SECTION_TITLE,
  NAV_SECTIONS,
  navSectionsForPortalAccess,
} from "../../src/core/dx/clients/layout/nav.js";

const navFeaturesOn: HubPortalNavFeatures = {
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
const _navFeaturesOff = buildHubNavFeatureSnapshot(
  loadFeatures({ FEATURE_MULTI_TENANCY_ENABLED: "false" }),
);

/**
 * Nav entries whose DATA endpoints are workstation-tier (dev-only
 * forever, see `hub-surface-policy.ts` and the #186 tier table) plus
 * the Prisma-Studio link (points at the developer's own localhost).
 * Outside development the sidebar must not offer them.
 */
const WORKSTATION_NAV_IDS = [
  // Features: reclassified to workstation in the consolidation (phase 3).
  "features",
  "coverage",
  "tests",
  "migrations",
  "erd",
  "emails",
  "prisma-studio",
  "permissions",
  "search",
  "files",
];

describe("Story · Hub nav filter", () => {
  it("shows every section for system admin (hub + tenant admin)", () => {
    expect(
      navSectionsForPortalAccess({
        hub: true,
        tenantAdmin: true,
        navFeatures: navFeaturesOn,
        workstation: true,
      }),
    ).toEqual(NAV_SECTIONS);
  });

  it("hides Admin section when tenantAdmin is false", () => {
    const sections = navSectionsForPortalAccess({
      hub: true,
      tenantAdmin: false,
      navFeatures: navFeaturesOn,
      workstation: true,
    });
    expect(sections.some((s) => s.title === ADMIN_NAV_SECTION_TITLE)).toBe(false);
    expect(sections.length).toBeGreaterThan(0);
  });

  it("hides Hub cockpit sections for tenant admin without hub", () => {
    const sections = navSectionsForPortalAccess({
      hub: false,
      tenantAdmin: true,
      navFeatures: navFeaturesOn,
      workstation: true,
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe(ADMIN_NAV_SECTION_TITLE);
  });

  it("nav model tags exactly the workstation-tier entries (#186 tier table)", () => {
    const tagged = NAV_SECTIONS.flatMap((s) => s.items)
      .filter((i) => i.tier === "workstation")
      .map((i) => i.id);
    expect([...tagged].sort()).toEqual([...WORKSTATION_NAV_IDS].sort());
  });

  it("workstation:false hides every workstation entry and keeps the operational console", () => {
    const sections = navSectionsForPortalAccess({
      hub: true,
      tenantAdmin: true,
      navFeatures: navFeaturesOn,
      workstation: false,
    });
    const ids = sections.flatMap((s) => s.items).map((i) => i.id);
    for (const id of WORKSTATION_NAV_IDS) {
      expect(ids, `nav must hide workstation entry "${id}"`).not.toContain(id);
    }
    for (const id of [
      "hub",
      "diagnostics",
      "brand",
      "logs",
      "traces",
      "queries",
      "jobs",
      "cron",
      "email-outbox",
      "scalar",
      "openapi",
      "routes",
      "errors",
      "users",
      "tenants",
      "sessions",
      "roles",
      "policies",
      "permissions-crud",
      "rate-limits",
      "webhooks",
      "realtime",
      "audit",
    ]) {
      expect(ids, `nav must keep operational entry "${id}"`).toContain(id);
    }
    // No section collapses to an empty shell.
    for (const section of sections) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it("tenant-admin-only nav outside development drops the workstation testers", () => {
    const sections = navSectionsForPortalAccess({
      hub: false,
      tenantAdmin: true,
      navFeatures: navFeaturesOn,
      workstation: false,
    });
    expect(sections).toHaveLength(1);
    const ids = sections[0]?.items.map((i) => i.id) ?? [];
    expect(ids).not.toContain("permissions");
    expect(ids).not.toContain("search");
    expect(ids).not.toContain("files");
    expect(ids).toContain("users");
  });
});
