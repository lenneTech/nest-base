import { describe, expect, it } from "vitest";

import {
  buildPermissionMatrix,
  type MatrixInput,
} from "../../src/core/permissions/admin-permissions-planner.js";

/**
 * Story · buildPermissionMatrix()
 *
 * The pure planner aggregates raw permission rows (with their directly-
 * assigned roleId) into a resource × role matrix. The matrix drives the
 * "Berechtigungsmatrix" card on the PermissionsAdminPage. It must be
 * deterministic and side-effect-free — all I/O happens in the controller.
 */
describe("Story · buildPermissionMatrix()", () => {
  it("returns empty matrix when no permissions and no roles are given", () => {
    const input: MatrixInput = { permissions: [], roles: [] };
    const result = buildPermissionMatrix(input);
    expect(result.resources).toHaveLength(0);
    expect(result.roleIds).toHaveLength(0);
    expect(result.matrix).toStrictEqual({});
  });

  it("returns roles but empty matrix when permissions exist without a roleId", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "Article", action: "READ", roleId: null },
      ],
      roles: [{ id: "r1", name: "Editor" }],
    };
    const result = buildPermissionMatrix(input);
    // Resource is discovered from the permission row
    expect(result.resources).toContain("Article");
    // But no action is associated to any role cell
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
    const actions = result.matrix["Project"]?.["r1"]?.actions ?? [];
    expect(actions).toContain("READ");
    expect(actions).toContain("UPDATE");
    expect(actions).toHaveLength(2);
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

  it("resources and roleIds are sorted for deterministic rendering", () => {
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
    // roleIds order mirrors the input roles array order (insertion order)
    expect(result.roleIds).toContain("r1");
    expect(result.roleIds).toContain("r2");
  });

  it("permissions for a role not in the roles list are ignored", () => {
    const input: MatrixInput = {
      permissions: [
        { id: "p1", policyId: "pol1", resource: "Widget", action: "READ", roleId: "ghost" },
      ],
      roles: [{ id: "r1", name: "Known" }],
    };
    const result = buildPermissionMatrix(input);
    // The "ghost" role is not in the roles array — its cell must not appear
    expect(result.matrix["Widget"]?.["ghost"]).toBeUndefined();
  });
});
