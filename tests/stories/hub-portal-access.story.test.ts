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
    expect(buildHubPortalAccessSnapshot(ability, navFeatures, true)).toEqual({
      hub: true,
      tenantAdmin: true,
      features: navFeatures,
      workstation: true,
    });
  });

  it("workstation availability flows through the snapshot verbatim (deployed = false)", () => {
    // Ability grants everything — yet outside development the snapshot
    // must still say workstation:false so the SPA can hide dev-only nav.
    const ability = buildAbility([{ action: "manage", subject: "all" }]);
    expect(buildHubPortalAccessSnapshot(ability, navFeatures, false)).toEqual({
      hub: true,
      tenantAdmin: true,
      features: navFeatures,
      workstation: false,
    });
  });

  it("read Hub without admin subjects grants hub only", () => {
    const ability = buildAbility([{ action: "read", subject: "Hub" }]);
    expect(canAccessHub(ability)).toBe(true);
    expect(canAccessTenantAdmin(ability)).toBe(false);
  });

  it("read DevHub (renamed Hub) does not grant hub portal access", () => {
    const ability = buildAbility([{ action: "read", subject: "DevHub" }]);
    expect(canAccessHub(ability)).toBe(false);
  });

  it("manage User grants tenant admin panel but not Hub (seeded Admin role)", () => {
    const ability = buildAbility([{ action: "manage", subject: "User" }]);
    expect(canAccessTenantAdmin(ability)).toBe(true);
    expect(canAccessHub(ability)).toBe(false);
    expect(buildHubPortalAccessSnapshot(ability, navFeatures, true)).toEqual({
      hub: false,
      tenantAdmin: true,
      features: navFeatures,
      workstation: true,
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
    expect(buildHubPortalAccessSnapshot(ability, navFeatures, true)).toEqual({
      hub: true,
      tenantAdmin: true,
      features: navFeatures,
      workstation: true,
    });
  });

  it("expanded manage:all bypass grants Hub and tenant admin", () => {
    const ability = buildAbility([
      { action: "create", subject: "all" },
      { action: "read", subject: "all" },
      { action: "update", subject: "all" },
      { action: "delete", subject: "all" },
    ]);
    expect(buildHubPortalAccessSnapshot(ability, navFeatures, true)).toEqual({
      hub: true,
      tenantAdmin: true,
      features: navFeatures,
      workstation: true,
    });
  });
});
