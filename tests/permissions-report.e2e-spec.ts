import { describe, expect, it } from "vitest";

import {
  buildPermissionReport,
  type PermissionReport,
} from "../src/core/permissions/permission-report.js";

/**
 * Adapted from nest-server `permissions-report.e2e-spec.ts`.
 *
 * The `/hub/admin/permissions/test` endpoint returns the **effective**
 * permission set for a given user. The serializer pinned here is
 * the contract that the (later) controller consumes.
 */
describe("Permissions report (effective set)", () => {
  it("groups roles + abilities by resource", () => {
    const report: PermissionReport = buildPermissionReport({
      userId: "u1",
      tenantId: "t1",
      rules: [
        { action: "read", subject: "Project" },
        { action: "create", subject: "Project" },
        { action: "read", subject: "File" },
      ],
    });
    expect(report.userId).toBe("u1");
    expect(report.byResource.Project.actions.sort()).toEqual(["create", "read"]);
    expect(report.byResource.File.actions).toEqual(["read"]);
  });

  it("marks a `manage` rule as superset (covers all actions)", () => {
    const report = buildPermissionReport({
      userId: "u1",
      tenantId: "t1",
      rules: [{ action: "manage", subject: "Project" }],
    });
    expect(report.byResource.Project.isSuperset).toBe(true);
  });

  it("returns an empty report when no rules apply", () => {
    const report = buildPermissionReport({ userId: "u1", tenantId: "t1", rules: [] });
    expect(report.byResource).toEqual({});
  });
});
