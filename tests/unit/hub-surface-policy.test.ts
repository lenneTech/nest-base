import { NotFoundException } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { assertHubSurfaceAvailable } from "../../src/core/hub/hub-surface-guard.js";
import {
  evaluateHubPortalRequestOutsideDev,
  isHubSurfaceAvailable,
} from "../../src/core/hub/hub-surface-policy.js";

describe("hub-surface-policy · isHubSurfaceAvailable", () => {
  it("development: both tiers available regardless of the flag", () => {
    for (const hubEnabled of [true, false]) {
      expect(isHubSurfaceAvailable({ env: "development", hubEnabled, tier: "operational" })).toBe(
        true,
      );
      expect(isHubSurfaceAvailable({ env: "development", hubEnabled, tier: "workstation" })).toBe(
        true,
      );
    }
  });

  it("production/staging: workstation tier is never available — flag or not", () => {
    for (const env of ["production", "staging"] as const) {
      for (const hubEnabled of [true, false]) {
        expect(isHubSurfaceAvailable({ env, hubEnabled, tier: "workstation" })).toBe(false);
      }
    }
  });

  it("production/staging: operational tier follows the flag", () => {
    for (const env of ["production", "staging"] as const) {
      expect(isHubSurfaceAvailable({ env, hubEnabled: true, tier: "operational" })).toBe(true);
      expect(isHubSurfaceAvailable({ env, hubEnabled: false, tier: "operational" })).toBe(false);
    }
  });
});

describe("hub-surface-policy · evaluateHubPortalRequestOutsideDev", () => {
  const base = {
    hubEnabled: true,
    authenticated: true,
    isProbePath: false,
    isCockpitPath: false,
    isTenantAdminPath: false,
    hubAllowed: false,
    tenantAdminAllowed: false,
  };

  it("flag off → pass-through (controllers keep today's behaviour untouched)", () => {
    expect(
      evaluateHubPortalRequestOutsideDev({
        ...base,
        hubEnabled: false,
        authenticated: false,
      }),
    ).toBe("pass-through");
    expect(
      evaluateHubPortalRequestOutsideDev({
        ...base,
        hubEnabled: false,
        isCockpitPath: true,
        hubAllowed: true,
      }),
    ).toBe("pass-through");
  });

  it("flag on + anonymous → not-found (mask, e.g. deployments without Better-Auth)", () => {
    expect(
      evaluateHubPortalRequestOutsideDev({
        ...base,
        authenticated: false,
        isCockpitPath: true,
        hubAllowed: true,
      }),
    ).toBe("not-found");
  });

  it("flag on + signed-in probe → allow (SPA renders the friendly denial)", () => {
    expect(evaluateHubPortalRequestOutsideDev({ ...base, isProbePath: true })).toBe("allow");
  });

  it("flag on + cockpit path follows canAccessHub", () => {
    expect(
      evaluateHubPortalRequestOutsideDev({ ...base, isCockpitPath: true, hubAllowed: true }),
    ).toBe("allow");
    expect(
      evaluateHubPortalRequestOutsideDev({ ...base, isCockpitPath: true, hubAllowed: false }),
    ).toBe("not-found");
  });

  it("flag on + tenant-admin path follows canAccessTenantAdmin", () => {
    expect(
      evaluateHubPortalRequestOutsideDev({
        ...base,
        isTenantAdminPath: true,
        tenantAdminAllowed: true,
      }),
    ).toBe("allow");
    expect(
      evaluateHubPortalRequestOutsideDev({
        ...base,
        isTenantAdminPath: true,
        tenantAdminAllowed: false,
      }),
    ).toBe("not-found");
  });

  it("abilities do not cross surfaces (hub ability opens /hub only, admin ability /admin only)", () => {
    expect(
      evaluateHubPortalRequestOutsideDev({
        ...base,
        isTenantAdminPath: true,
        hubAllowed: true,
      }),
    ).toBe("not-found");
    expect(
      evaluateHubPortalRequestOutsideDev({
        ...base,
        isCockpitPath: true,
        tenantAdminAllowed: true,
      }),
    ).toBe("not-found");
  });
});

describe("hub-surface-guard · assertHubSurfaceAvailable", () => {
  it("development env: passes for both tiers without any flag", () => {
    expect(() =>
      assertHubSurfaceAvailable("operational", { NODE_ENV: "development" }),
    ).not.toThrow();
    expect(() =>
      assertHubSurfaceAvailable("workstation", { NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("NODE_ENV=test maps to development (vitest workers keep full access)", () => {
    expect(() => assertHubSurfaceAvailable("workstation", { NODE_ENV: "test" })).not.toThrow();
  });

  it("production without the flag: operational tier 404s (today's behaviour)", () => {
    expect(() => assertHubSurfaceAvailable("operational", { NODE_ENV: "production" })).toThrow(
      NotFoundException,
    );
  });

  it("production with the flag: operational passes, workstation still 404s", () => {
    const env = { NODE_ENV: "production", FEATURE_HUB_ENABLED: "true" };
    expect(() => assertHubSurfaceAvailable("operational", env)).not.toThrow();
    expect(() => assertHubSurfaceAvailable("workstation", env)).toThrow(NotFoundException);
  });

  it("staging behaves like production", () => {
    expect(() => assertHubSurfaceAvailable("operational", { NODE_ENV: "staging" })).toThrow(
      NotFoundException,
    );
    expect(() =>
      assertHubSurfaceAvailable("operational", {
        NODE_ENV: "staging",
        FEATURE_HUB_ENABLED: "true",
      }),
    ).not.toThrow();
  });
});
