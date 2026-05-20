/**
 * Pure planner for building the permission matrix used by the
 * "Berechtigungsmatrix" view on the PermissionsAdminPage.
 *
 * All inputs are plain data — no Prisma, no HTTP, no side effects.
 * The controller calls `buildPermissionMatrix()` with rows fetched
 * from Prisma and returns the result as JSON.
 */

export const MATRIX_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "SHARE"] as const;
export type MatrixAction = (typeof MATRIX_ACTIONS)[number];

export interface MatrixPermissionGrant {
  permissionId: string;
  policyId: string;
  /** Expanded from `manage` on subject `all` — do not edit per resource. */
  source?: "direct" | "manage-all";
}

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
  /** Canonical CASL subjects — every row appears even with zero grants. */
  catalogResources?: readonly string[];
  /** First policy attached to each role (for matrix toggles). */
  rolePrimaryPolicyIds?: Readonly<Record<string, string>>;
}

export interface MatrixCell {
  actions: string[];
  /** Explicit grants keyed by stored action (incl. MANAGE). */
  grants: Partial<Record<string, MatrixPermissionGrant>>;
}

export type MatrixOutput = {
  /** All matrix rows (catalog ∪ permission resources), sorted. */
  resources: string[];
  /** Role IDs in the order they appear in the `roles` input array. */
  roleIds: string[];
  /** matrix[resource][roleId] */
  matrix: Record<string, Record<string, MatrixCell>>;
  /** First attached policy per role — used when granting new cells. */
  rolePrimaryPolicyIds: Record<string, string>;
  /** Full canonical subject list returned for clients. */
  catalogResources: string[];
  /** Roles with `MANAGE` on wildcard subject `all` (system-admin bypass). */
  manageAllRoleIds: string[];
};

const MATRIX_EXCLUDED_RESOURCES = new Set(["all"]);

/** DB seed stores system-admin bypass as CRUD on `all` (no MANAGE enum). */
const MANAGE_ALL_BYPASS_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE"] as const;

function findManageAllGrant(
  permissions: MatrixInput["permissions"],
  roleId: string,
): MatrixPermissionGrant | undefined {
  const onAll = permissions.filter((p) => p.roleId === roleId && p.resource === "all");
  if (onAll.length === 0) return undefined;

  const manageRow = onAll.find((p) => String(p.action).toUpperCase() === "MANAGE");
  if (manageRow) {
    return {
      permissionId: manageRow.id,
      policyId: manageRow.policyId,
      source: "manage-all",
    };
  }

  const actions = new Set(onAll.map((p) => String(p.action).toUpperCase()));
  if (!MANAGE_ALL_BYPASS_ACTIONS.every((a) => actions.has(a))) return undefined;

  const anchor = onAll.find((p) => String(p.action).toUpperCase() === "CREATE") ?? onAll[0];
  return {
    permissionId: anchor.id,
    policyId: anchor.policyId,
    source: "manage-all",
  };
}

/**
 * True when the cell should show the checkbox checked for `action`.
 * `MANAGE` implies every matrix action.
 */
export function matrixCellHasAction(cell: MatrixCell, action: MatrixAction): boolean {
  const upper = cell.actions.map((a) => a.toUpperCase());
  if (upper.includes("MANAGE")) return true;
  return upper.includes(action);
}

/**
 * Resolve the permission row to delete when unchecking `action`.
 * Prefers an exact action grant; falls back to MANAGE.
 */
export function matrixCellGrantForAction(
  cell: MatrixCell,
  action: MatrixAction,
): MatrixPermissionGrant | undefined {
  const direct = cell.grants[action];
  if (direct) return direct;
  return cell.grants.MANAGE;
}

/**
 * Build the permission matrix from raw permission rows.
 *
 * Permissions whose `roleId` maps to a known role contribute to cells.
 * Rows come from `catalogResources` merged with any resource seen in
 * permission data (excluding the wildcard `all` subject).
 */
export function buildPermissionMatrix(input: MatrixInput): MatrixOutput {
  const knownRoleIds = new Set(input.roles.map((r) => r.id));

  const resourceSet = new Set<string>();
  for (const resource of input.catalogResources ?? []) {
    if (!MATRIX_EXCLUDED_RESOURCES.has(resource)) resourceSet.add(resource);
  }
  for (const perm of input.permissions) {
    if (!MATRIX_EXCLUDED_RESOURCES.has(perm.resource)) resourceSet.add(perm.resource);
  }
  const resources = Array.from(resourceSet).sort((a, b) => a.localeCompare(b));
  const catalogResources = [...resources];

  const roleIds = input.roles.map((r) => r.id);
  const rolePrimaryPolicyIds: Record<string, string> = {
    ...(input.rolePrimaryPolicyIds ?? {}),
  };

  const matrix: Record<string, Record<string, MatrixCell>> = {};

  for (const resource of resources) {
    matrix[resource] = {};
    for (const roleId of roleIds) {
      matrix[resource][roleId] = { actions: [], grants: {} };
    }
  }

  const manageAllGrants = new Map<string, MatrixPermissionGrant>();
  for (const roleId of roleIds) {
    const grant = findManageAllGrant(input.permissions, roleId);
    if (grant) manageAllGrants.set(roleId, grant);
  }

  for (const perm of input.permissions) {
    if (perm.roleId === null || !knownRoleIds.has(perm.roleId)) continue;
    if (perm.resource === "all") continue;

    const actionKey = String(perm.action).toUpperCase();
    const grant: MatrixPermissionGrant = {
      permissionId: perm.id,
      policyId: perm.policyId,
      source: "direct",
    };

    const cell = matrix[perm.resource]?.[perm.roleId];
    if (!cell) continue;

    if (!cell.actions.includes(actionKey)) cell.actions.push(actionKey);
    cell.grants[actionKey] = grant;
  }

  for (const [roleId, grant] of manageAllGrants) {
    for (const resource of resources) {
      const cell = matrix[resource][roleId];
      if (!cell.actions.includes("MANAGE")) cell.actions.push("MANAGE");
      cell.grants.MANAGE = grant;
    }
  }

  const manageAllRoleIds = Array.from(manageAllGrants.keys());

  return {
    resources,
    roleIds,
    matrix,
    rolePrimaryPolicyIds,
    catalogResources,
    manageAllRoleIds,
  };
}
