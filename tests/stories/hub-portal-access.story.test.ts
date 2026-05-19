import { describe, expect, it } from "vitest";

import {
  buildHubPortalAccessSnapshot,
  canAccessDevHub,
  canAccessTenantAdmin,
} from "../../src/core/hub/hub-portal-access.js";
import { buildAbility } from "../../src/core/permissions/casl-ability.js";

describe("Story · Hub portal CASL access", () => {
  it("system-admin manage:all grants DevHub and tenant admin", () => {
    const ability = buildAbility([{ action: "manage", subject: "all" }]);
    expect(canAccessDevHub(ability)).toBe(true);
    expect(canAccessTenantAdmin(ability)).toBe(true);
    expect(buildHubPortalAccessSnapshot(ability)).toEqual({ devHub: true, tenantAdmin: true });
  });

  it("read DevHub without admin subjects grants hub only", () => {
    const ability = buildAbility([{ action: "read", subject: "DevHub" }]);
    expect(canAccessDevHub(ability)).toBe(true);
    expect(canAccessTenantAdmin(ability)).toBe(false);
  });

  it("manage User grants tenant admin panel", () => {
    const ability = buildAbility([{ action: "manage", subject: "User" }]);
    expect(canAccessTenantAdmin(ability)).toBe(true);
    expect(canAccessDevHub(ability)).toBe(false);
  });
});
