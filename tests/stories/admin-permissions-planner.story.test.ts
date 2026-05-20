import { describe, expect, it } from "vitest";

import {
  buildPermissionMatrix,
  matrixCellGrantForAction,
  matrixCellHasAction,
  type MatrixInput,
} from "../../src/core/permissions/admin-permissions-planner.js";

/**
 * Story · buildPermissionMatrix()
 *
 * The pure planner aggregates raw permission rows (with their directly-
 * assigned roleId) into a resource × role matrix. The matrix drives the
 * "Berechtigungsmatrix" on the PermissionsAdminPage. It must be
 * deterministic and side-effect-free — all I/O happens in the controller.
 */
describe("Story · buildPermissionMatrix()", () => {
  it("returns empty matrix when no permissions and no roles are given", () => {
    const input: MatrixInput = { permissions: [], roles: [] };
    const result = buildPermissionMatrix(input);
    expect(result.resources).toHaveLength(0);
    expect(result.roleIds).toHaveLength(0);
    expect(result.matrix).toStrictEqual({});
    expect(result.rolePrimaryPolicyIds).toStrictEqual({});
    expect(result.manageAllRoleIds).toStrictEqual([]);
  });

  it("includes catalog resources even when no permission rows exist", () => {
    const input: MatrixInput = {
      permissions: [],
      roles: [{ id: "r1", name: "Editor" }],
      catalogResources: ["Article", "File"],
    };
    const result = buildPermissionMatrix(input);
    expect(result.resources).toStrictEqual(["Article", "File"]);
    expect(result.matrix.Article?.r1).toStrictEqual({ actions: [], grants: {} });
  });

  it("excludes wildcard resource `all` from rows but expands manage:all to every catalog cell", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "all", action: "MANAGE", roleId: "r1" },
      ],
      roles: [{ id: "r1", name: "System Admin" }],
      catalogResources: ["all", "User", "File"],
    };
    const result = buildPermissionMatrix(input);
    expect(result.resources).toContain("User");
    expect(result.resources).toContain("File");
    expect(result.resources).not.toContain("all");
    expect(result.manageAllRoleIds).toStrictEqual(["r1"]);
    for (const resource of ["User", "File"]) {
      expect(matrixCellHasAction(result.matrix[resource]!.r1, "READ")).toBe(true);
      expect(result.matrix[resource]?.r1?.grants.MANAGE).toStrictEqual({
        permissionId: "p1",
        policyId: "pol1",
        source: "manage-all",
      });
    }
  });

  it("expands seeded system-admin bypass (CRUD on `all`) to every catalog cell", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p-c", policyId: "pol1", resource: "all", action: "CREATE", roleId: "r1" },
        { id: "p-r", policyId: "pol1", resource: "all", action: "READ", roleId: "r1" },
        { id: "p-u", policyId: "pol1", resource: "all", action: "UPDATE", roleId: "r1" },
        { id: "p-d", policyId: "pol1", resource: "all", action: "DELETE", roleId: "r1" },
      ],
      roles: [{ id: "r1", name: "System Admin" }],
      catalogResources: ["User"],
    };
    const result = buildPermissionMatrix(input);
    expect(result.manageAllRoleIds).toStrictEqual(["r1"]);
    expect(matrixCellHasAction(result.matrix.User!.r1, "DELETE")).toBe(true);
    expect(result.matrix.User?.r1?.grants.MANAGE?.source).toBe("manage-all");
  });

  it("returns roles but empty matrix when permissions exist without a roleId", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "Article", action: "READ", roleId: null },
      ],
      roles: [{ id: "r1", name: "Editor" }],
    };
    const result = buildPermissionMatrix(input);
    expect(result.resources).toContain("Article");
    expect(result.matrix["Article"]?.["r1"]?.actions ?? []).toHaveLength(0);
  });

  it("single permission with one role → matrix shows that resource/role/action", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "Article", action: "READ", roleId: "r1" },
      ],
      roles: [{ id: "r1", name: "Editor" }],
    };
    const result = buildPermissionMatrix(input);
    expect(result.resources).toStrictEqual(["Article"]);
    expect(result.roleIds).toStrictEqual(["r1"]);
    expect(result.matrix["Article"]?.["r1"]?.actions).toStrictEqual(["READ"]);
    expect(result.matrix["Article"]?.["r1"]?.grants.READ).toStrictEqual({
      permissionId: "p1",
      policyId: "pol1",
      source: "direct",
    });
  });

  it("multiple actions for the same resource + role are all included", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "Project", action: "READ", roleId: "r1" },
        { id: "p2", policyId: "pol1", resource: "Project", action: "UPDATE", roleId: "r1" },
      ],
      roles: [{ id: "r1", name: "Manager" }],
    };
    const result = buildPermissionMatrix(input);
    const cell = result.matrix.Project?.r1;
    expect(cell?.actions).toContain("READ");
    expect(cell?.actions).toContain("UPDATE");
    expect(cell?.actions).toHaveLength(2);
  });

  it("MANAGE implies every matrix action in matrixCellHasAction", () => {
    const cell = {
      actions: ["MANAGE"],
      grants: { MANAGE: { permissionId: "p1", policyId: "pol1" } },
    };
    expect(matrixCellHasAction(cell, "READ")).toBe(true);
    expect(matrixCellHasAction(cell, "DELETE")).toBe(true);
    expect(matrixCellGrantForAction(cell, "READ")?.permissionId).toBe("p1");
  });

  it("multiple roles with shared resource → each role shows only its own actions", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "Order", action: "READ", roleId: "r1" },
        { id: "p2", policyId: "pol2", resource: "Order", action: "CREATE", roleId: "r2" },
        { id: "p3", policyId: "pol2", resource: "Order", action: "DELETE", roleId: "r2" },
      ],
      roles: [
        { id: "r1", name: "Viewer" },
        { id: "r2", name: "Admin" },
      ],
    };
    const result = buildPermissionMatrix(input);
    expect(result.matrix["Order"]?.["r1"]?.actions).toStrictEqual(["READ"]);
    expect(result.matrix["Order"]?.["r2"]?.actions).toContain("CREATE");
    expect(result.matrix["Order"]?.["r2"]?.actions).toContain("DELETE");
  });

  it("resources are sorted alphabetically", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "Zebra", action: "READ", roleId: "r2" },
        { id: "p2", policyId: "pol2", resource: "Apple", action: "READ", roleId: "r1" },
      ],
      roles: [
        { id: "r2", name: "B-Role" },
        { id: "r1", name: "A-Role" },
      ],
    };
    const result = buildPermissionMatrix(input);
    expect(result.resources[0]).toBe("Apple");
    expect(result.resources[1]).toBe("Zebra");
  });

  it("passes through rolePrimaryPolicyIds", () => {
    const input: MatrixInput = {
      permissions: [],
      roles: [{ id: "r1", name: "A" }],
      rolePrimaryPolicyIds: { r1: "pol-primary" },
    };
    const result = buildPermissionMatrix(input);
    expect(result.rolePrimaryPolicyIds.r1).toBe("pol-primary");
  });

  it("permissions for a role not in the roles list are ignored", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "Widget", action: "READ", roleId: "ghost" },
      ],
      roles: [{ id: "r1", name: "Known" }],
    };
    const result = buildPermissionMatrix(input);
    expect(result.matrix["Widget"]?.["ghost"]).toBeUndefined();
  });
});
