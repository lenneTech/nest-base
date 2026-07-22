import { describe, expect, it } from "vitest";

import { resolveOperatorLandingPath } from "../../src/core/dx/clients/lib/hub-portal-access.js";

describe("resolveOperatorLandingPath", () => {
  it("defaults to /hub when the operator has Hub access", () => {
    expect(resolveOperatorLandingPath({ hub: true })).toBe("/hub");
  });

  it("defaults to /hub/admin/users for tenant-admin-only accounts", () => {
    expect(resolveOperatorLandingPath({ tenantAdmin: true })).toBe("/hub/admin/users");
  });

  it("returns / when the account has no portal access", () => {
    expect(resolveOperatorLandingPath({})).toBe("/");
  });

  it("treats from=/ like no deep-link and picks the default landing", () => {
    expect(resolveOperatorLandingPath({ hub: true }, "/")).toBe("/hub");
  });

  it("honours a protected deep-link when access allows it", () => {
    expect(resolveOperatorLandingPath({ hub: true }, "/hub/logs")).toBe("/hub/logs");
  });

  it("falls back when a deep-link exceeds access", () => {
    expect(resolveOperatorLandingPath({ tenantAdmin: true }, "/hub/logs")).toBe("/hub/admin/users");
  });
});
