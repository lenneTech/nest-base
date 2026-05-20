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

describe("Story · Hub nav filter", () => {
  it("shows every section for system admin (hub + tenant admin)", () => {
    expect(
      navSectionsForPortalAccess({ hub: true, tenantAdmin: true, navFeatures: navFeaturesOn }),
    ).toEqual(NAV_SECTIONS);
  });

  it("hides Admin section when tenantAdmin is false", () => {
    const sections = navSectionsForPortalAccess({
      hub: true,
      tenantAdmin: false,
      navFeatures: navFeaturesOn,
    });
    expect(sections.some((s) => s.title === ADMIN_NAV_SECTION_TITLE)).toBe(false);
    expect(sections.length).toBeGreaterThan(0);
  });

  it("hides Hub cockpit sections for tenant admin without hub", () => {
    const sections = navSectionsForPortalAccess({
      hub: false,
      tenantAdmin: true,
      navFeatures: navFeaturesOn,
    });
    expect(sections).toHaveLength(1);
    expect(sections[0]?.title).toBe(ADMIN_NAV_SECTION_TITLE);
  });
});
