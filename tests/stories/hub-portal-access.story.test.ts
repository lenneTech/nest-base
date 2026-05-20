import { describe, expect, it } from "vitest";

import { buildHubNavFeatureSnapshot } from "../../src/core/dx/hub-nav-planner.js";
import { loadFeatures } from "../../src/core/features/features.js";
import {
  buildHubPortalAccessSnapshot,
  canAccessHub,
  canAccessTenantAdmin,
} from "../../src/core/hub/hub-portal-access.js";
import { buildAbility } from "../../src/core/permissions/casl-ability.js";

const navFeatures = buildHubNavFeatureSnapshot(loadFeatures({}));

describe("Story · Hub portal CASL access", () => {
  it("portal-access snapshot reflects loadFeatures() defaults for nav toggles", () => {
    expect(navFeatures).toEqual(buildHubNavFeatureSnapshot(loadFeatures({})));
    expect(navFeatures.webhooks).toBe(false);
    expect(navFeatures.search).toBe(false);
    expect(navFeatures.realtime).toBe(false);
    expect(navFeatures.multiTenancy).toBe(true);
  });

  it("system-admin manage:all grants Hub and tenant admin", () => {
    const ability = buildAbility([{ action: "manage", subject: "all" }]);
    expect(canAccessHub(ability)).toBe(true);
    expect(canAccessTenantAdmin(ability)).toBe(true);
    expect(buildHubPortalAccessSnapshot(ability, navFeatures)).toEqual({
      hub: true,
      tenantAdmin: true,
      features: navFeatures,
    });
  });

  it("read Hub without admin subjects grants hub only", () => {
    const ability = buildAbility([{ action: "read", subject: "Hub" }]);
    expect(canAccessHub(ability)).toBe(true);
    expect(canAccessTenantAdmin(ability)).toBe(false);
  });

  it("legacy read DevHub still grants hub until DB rows are re-seeded", () => {
    const ability = buildAbility([{ action: "read", subject: "DevHub" }]);
    expect(canAccessHub(ability)).toBe(true);
    expect(buildHubPortalAccessSnapshot(ability, navFeatures)).toEqual({
      hub: true,
      tenantAdmin: false,
      features: navFeatures,
    });
  });

  it("manage User grants tenant admin panel but not Hub (seeded Admin role)", () => {
    const ability = buildAbility([{ action: "manage", subject: "User" }]);
    expect(canAccessTenantAdmin(ability)).toBe(true);
    expect(canAccessHub(ability)).toBe(false);
    expect(buildHubPortalAccessSnapshot(ability, navFeatures)).toEqual({
      hub: false,
      tenantAdmin: true,
      features: navFeatures,
    });
  });

  it("expanded MANAGE rows (CREATE+READ+UPDATE+DELETE) count as tenant admin", () => {
    const ability = buildAbility([
      { action: "create", subject: "User" },
      { action: "read", subject: "User" },
      { action: "update", subject: "User" },
      { action: "delete", subject: "User" },
      { action: "read", subject: "Hub" },
    ]);
    expect(canAccessTenantAdmin(ability)).toBe(true);
    expect(buildHubPortalAccessSnapshot(ability, navFeatures)).toEqual({
      hub: true,
      tenantAdmin: true,
      features: navFeatures,
    });
  });

  it("expanded manage:all bypass grants Hub and tenant admin", () => {
    const ability = buildAbility([
      { action: "create", subject: "all" },
      { action: "read", subject: "all" },
      { action: "update", subject: "all" },
      { action: "delete", subject: "all" },
    ]);
    expect(buildHubPortalAccessSnapshot(ability, navFeatures)).toEqual({
      hub: true,
      tenantAdmin: true,
      features: navFeatures,
    });
  });
});
