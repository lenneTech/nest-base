/** Matrix actions shown as checkbox columns (client-safe copy of planner constants). */
export const MATRIX_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "SHARE"] as const;
export type MatrixAction = (typeof MATRIX_ACTIONS)[number];

export interface MatrixPermissionGrant {
  permissionId: string;
  policyId: string;
  source?: "direct" | "manage-all";
}

export interface MatrixCell {
  actions: string[];
  grants: Partial<Record<string, MatrixPermissionGrant>>;
}

export function normalizeMatrixCell(cell: Partial<MatrixCell> | null | undefined): MatrixCell {
  return {
    actions: Array.isArray(cell?.actions) ? cell.actions : [],
    grants: cell?.grants && typeof cell.grants === "object" ? cell.grants : {},
  };
}

export function matrixCellHasAction(
  cell: Partial<MatrixCell> | null | undefined,
  action: MatrixAction,
): boolean {
  const normalized = normalizeMatrixCell(cell);
  const upper = normalized.actions.map((a) => a.toUpperCase());
  if (upper.includes("MANAGE")) return true;
  return upper.includes(action);
}

export function matrixCellGrantForAction(
  cell: Partial<MatrixCell> | null | undefined,
  action: MatrixAction,
): MatrixPermissionGrant | undefined {
  const normalized = normalizeMatrixCell(cell);
  const direct = normalized.grants[action];
  if (direct) return direct;
  return normalized.grants.MANAGE;
}
