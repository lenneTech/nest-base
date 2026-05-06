/**
 * Pure planner for building the permission matrix used by the
 * "Berechtigungsmatrix" view on the PermissionsAdminPage.
 *
 * All inputs are plain data — no Prisma, no HTTP, no side effects.
 * The controller calls `buildPermissionMatrix()` with rows fetched
 * from Prisma and returns the result as JSON.
 */

export interface MatrixInput {
  permissions: ReadonlyArray<{
    id: string;
    policyId: string;
    resource: string;
    action: string;
    roleId: string | null;
  }>;
  roles: ReadonlyArray<{
    id: string;
    name: string;
  }>;
}

export interface MatrixCell {
  actions: string[];
}

export type MatrixOutput = {
  /** Distinct resource names, sorted alphabetically. */
  resources: string[];
  /** Role IDs in the order they appear in the `roles` input array. */
  roleIds: string[];
  /** matrix[resource][roleId] = { actions } */
  matrix: Record<string, Record<string, MatrixCell>>;
};

/**
 * Build the permission matrix from raw permission rows.
 *
 * Only permissions whose `roleId` maps to a known role in the `roles`
 * array contribute to cells — permissions without a `roleId` (attached
 * through a policy chain rather than directly) are included in the
 * resource list but produce no cell actions. This keeps the matrix
 * honest: a cell only lights up when we have a direct role→permission
 * mapping in the data set.
 */
export function buildPermissionMatrix(input: MatrixInput): MatrixOutput {
  const knownRoleIds = new Set(input.roles.map((r) => r.id));

  // Collect all distinct resources (sorted for deterministic rendering).
  const resourceSet = new Set<string>();
  for (const perm of input.permissions) {
    resourceSet.add(perm.resource);
  }
  const resources = Array.from(resourceSet).sort();

  // Role IDs preserve insertion order from the input roles array.
  const roleIds = input.roles.map((r) => r.id);

  // Populate the matrix.
  const matrix: Record<string, Record<string, MatrixCell>> = {};

  for (const resource of resources) {
    matrix[resource] = {};
    for (const roleId of roleIds) {
      matrix[resource][roleId] = { actions: [] };
    }
  }

  for (const perm of input.permissions) {
    // Skip permissions that have no direct role assignment or belong to
    // a role not in the provided roles list.
    if (perm.roleId === null || !knownRoleIds.has(perm.roleId)) continue;

    const cell = matrix[perm.resource]?.[perm.roleId];
    if (cell) {
      cell.actions.push(perm.action);
    }
  }

  return { resources, roleIds, matrix };
}
