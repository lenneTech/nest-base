import { describe, expect, it } from "vitest";

import {
  ADMIN_NAV_SECTION_TITLE,
  navSectionsForPortalAccess,
  NAV_SECTIONS,
} from "../../src/core/dx/clients/layout/nav.js";

describe("Story · Hub sidebar nav filter", () => {
  it("keeps all sections when tenantAdmin is true", () => {
    expect(navSectionsForPortalAccess(true)).toEqual(NAV_SECTIONS);
  });

  it("drops the Admin section when tenantAdmin is false", () => {
    const sections = navSectionsForPortalAccess(false);
    expect(sections.map((s) => s.title)).not.toContain(ADMIN_NAV_SECTION_TITLE);
    expect(sections.length).toBe(NAV_SECTIONS.length - 1);
  });
});
