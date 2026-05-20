/**
 * `/admin/permissions` — Permission matrix (roles × resources × actions).
 * Checkbox toggles grant/revoke via existing `/admin/permissions` CRUD.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Checkbox } from "../components/ui/checkbox.js";
import { Input } from "../components/ui/input.js";
import { Label } from "../components/ui/label.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { SortableTableHead } from "../components/SortableTableHead.js";
import { AdminShell } from "../layout/AdminShell.js";
import { adminFetch, fetchJson, needsAdminAuthHint } from "../lib/api.js";
import { bootstrapHubOperatorSession } from "../lib/hub-session-bootstrap.js";
import {
  MATRIX_ACTIONS,
  type MatrixAction,
  type MatrixCell,
  matrixCellGrantForAction,
  matrixCellHasAction,
  normalizeMatrixCell,
} from "../lib/permission-matrix.js";
import { useTableSort } from "../lib/use-table-sort.js";

interface MatrixResponse {
  resources: string[];
  roleIds: string[];
  matrix: Record<string, Record<string, MatrixCell>>;
  rolePrimaryPolicyIds: Record<string, string>;
  catalogResources: string[];
  manageAllRoleIds: string[];
}

interface RoleRecord {
  id: string;
  name: string;
}

const ACTION_LABELS: Record<MatrixAction, string> = {
  CREATE: "C",
  READ: "R",
  UPDATE: "U",
  DELETE: "D",
  SHARE: "S",
};

export function PermissionsAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState("");
  const [resourceFilter, setResourceFilter] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [tenantBootstrapDone, setTenantBootstrapDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const bootstrapped = await bootstrapHubOperatorSession();
      if (!cancelled && bootstrapped) setTenantId(bootstrapped);
      if (!cancelled) setTenantBootstrapDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const matrix = useQuery({
    queryKey: ["admin", "permissions", "matrix", tenantId],
    queryFn: () => fetchJson<MatrixResponse>("/admin/permissions/matrix.json"),
    enabled: tenantId.trim().length > 0,
  });

  const roles = useQuery({
    queryKey: ["admin", "roles", tenantId],
    queryFn: () => fetchJson<RoleRecord[]>("/admin/roles"),
    enabled: tenantId.trim().length > 0,
  });

  const roleNameMap = useMemo(
    () => new Map((roles.data ?? []).map((r) => [r.id, r.name])),
    [roles.data],
  );

  const manageAllRoleIds = useMemo(
    () => new Set(Array.isArray(matrix.data?.manageAllRoleIds) ? matrix.data.manageAllRoleIds : []),
    [matrix.data?.manageAllRoleIds],
  );

  const roleIds = useMemo(
    () => (Array.isArray(matrix.data?.roleIds) ? matrix.data.roleIds : []),
    [matrix.data?.roleIds],
  );

  const filteredResources = useMemo(() => {
    const list = matrix.data?.resources ?? [];
    const q = resourceFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((res) => res.toLowerCase().includes(q));
  }, [matrix.data?.resources, resourceFilter]);

  const resourceRows = useMemo(
    () => filteredResources.map((resource) => ({ resource })),
    [filteredResources],
  );
  const {
    sortedRows: sortedResourceRows,
    sortKey,
    sortDirection,
    toggleSort,
  } = useTableSort(resourceRows, { defaultSort: { key: "resource", direction: "asc" } });

  const toggle = useMutation({
    mutationFn: async (input: {
      roleId: string;
      roleName: string;
      resource: string;
      action: MatrixAction;
      checked: boolean;
      cell: MatrixCell;
    }) => {
      const key = `${input.roleId}:${input.resource}:${input.action}`;
      setPendingKey(key);
      try {
        if (input.checked) {
          await grantMatrixAction(tenantId, input, matrix.data?.rolePrimaryPolicyIds ?? {});
        } else {
          await revokeMatrixAction(tenantId, input);
        }
      } finally {
        setPendingKey(null);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "permissions", "matrix", tenantId] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not save permission.");
    },
  });

  const hasRoles = roleIds.length > 0;
  const hasResources = (matrix.data?.resources.length ?? 0) > 0;
  const showManualTenantField = tenantBootstrapDone && tenantId.trim().length === 0;

  return (
    <AdminShell
      title="Permissions"
      subtitle="Matrix: roles × resources × actions — grant or revoke via checkbox"
      currentNav="permissions-crud"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          {showManualTenantField ? (
            <div className="flex min-w-[16rem] flex-col gap-1">
              <Label htmlFor="matrix-tenant">Tenant-UUID</Label>
              <Input
                id="matrix-tenant"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
                className="w-72"
                placeholder="Enter UUID…"
                autoComplete="off"
              />
            </div>
          ) : null}
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <Label htmlFor="matrix-filter">Filter resources</Label>
            <Input
              id="matrix-filter"
              value={resourceFilter}
              onChange={(e) => setResourceFilter(e.target.value)}
              placeholder="e.g. File, User…"
              disabled={!hasResources}
            />
          </div>
        </div>

        {!tenantBootstrapDone ? (
          <PageLoading>Loading tenant from session…</PageLoading>
        ) : tenantId.trim().length === 0 ? (
          <PageEmpty>
            No active tenant — choose an organization in Better Auth or enter a tenant UUID.
          </PageEmpty>
        ) : matrix.isPending || roles.isPending ? (
          <PageLoading>Loading permission matrix…</PageLoading>
        ) : matrix.isError ? (
          <PageError showAuthHint={needsAdminAuthHint(matrix.error)}>
            Could not load permission matrix.
          </PageError>
        ) : !hasRoles ? (
          <PageEmpty>
            No roles for this tenant. Create at least one role under Roles first.
          </PageEmpty>
        ) : !hasResources ? (
          <PageEmpty>No resources in the catalog — contact an administrator.</PageEmpty>
        ) : filteredResources.length === 0 ? (
          <PageEmpty>No resources match the filter.</PageEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTableHead
                  label="Resource"
                  sortKey="resource"
                  activeSortKey={sortKey}
                  sortDirection={sortDirection}
                  onSort={toggleSort}
                  className="sticky left-0 z-20 min-w-[9rem] bg-surface-1"
                />
                {roleIds.map((roleId) => {
                  const fullAccess = manageAllRoleIds.has(roleId);
                  return (
                    <TableHead
                      key={roleId}
                      colSpan={MATRIX_ACTIONS.length}
                      className="border-l border-line text-center text-xs font-semibold"
                    >
                      <span className="sr-only">Role </span>
                      <span className="inline-flex flex-col items-center gap-0.5">
                        <span>{roleNameMap.get(roleId) ?? roleId.slice(0, 8)}</span>
                        {fullAccess ? (
                          <span
                            className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-normal text-accent"
                            title="manage:all on all resources"
                          >
                            Full access
                          </span>
                        ) : null}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
              <TableRow>
                <TableHead className="sticky left-0 z-20 bg-surface-1" />
                {roleIds.map((roleId) =>
                  MATRIX_ACTIONS.map((action) => (
                    <TableHead
                      key={`${roleId}-${action}`}
                      className="w-9 border-l border-line px-1 text-center text-[10px] font-normal text-fg-muted"
                      title={action}
                    >
                      <span className="sr-only">
                        {roleNameMap.get(roleId) ?? roleId} — {action}
                      </span>
                      {ACTION_LABELS[action]}
                    </TableHead>
                  )),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedResourceRows.map(({ resource }) => (
                <TableRow key={resource}>
                  <TableCell className="sticky left-0 z-10 bg-surface-1 font-medium">
                    {resource}
                  </TableCell>
                  {roleIds.map((roleId) => {
                    const cell = normalizeMatrixCell(matrix.data?.matrix[resource]?.[roleId]);
                    const roleName = roleNameMap.get(roleId) ?? roleId;
                    const fullAccess = manageAllRoleIds.has(roleId);
                    return MATRIX_ACTIONS.map((action) => {
                      const checked = matrixCellHasAction(cell, action);
                      const cellKey = `${roleId}:${resource}:${action}`;
                      const busy = pendingKey === cellKey || toggle.isPending;
                      const checkboxId = `perm-${cellKey}`;
                      return (
                        <TableCell key={cellKey} className="border-l border-line p-1 text-center">
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            disabled={busy || fullAccess}
                            aria-label={`${roleName}: ${action} on ${resource}`}
                            onCheckedChange={(value) => {
                              const next = value === true;
                              if (next === checked) return;
                              toggle.mutate({
                                roleId,
                                roleName,
                                resource,
                                action,
                                checked: next,
                                cell,
                              });
                            }}
                          />
                        </TableCell>
                      );
                    });
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <p className="text-xs text-fg-muted">
          Columns: C=Create, R=Read, U=Update, D=Delete, S=Share. "Full access" = stored{" "}
          <code className="text-[11px]">manage:all</code> (all catalog resources checked and not
          individually editable). Otherwise permissions from the first policy of the role are used;
          if no policy exists, a matrix policy is created automatically.
        </p>
      </div>
    </AdminShell>
  );
}

async function resolvePolicyIdForRole(
  tenantId: string,
  roleId: string,
  roleName: string,
  rolePrimaryPolicyIds: Record<string, string>,
): Promise<string> {
  const existing = rolePrimaryPolicyIds[roleId];
  if (existing) return existing;

  const policyRes = await adminFetch("/admin/policies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: `Matrix — ${roleName}`,
      description: "Created automatically for permission matrix",
    }),
  });
  if (!policyRes.ok) {
    throw new Error(`Failed to create policy (${policyRes.status})`);
  }
  const policy = (await policyRes.json()) as { id: string };

  const attachRes = await adminFetch("/admin/permissions/attach", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ roleId, policyId: policy.id }),
  });
  if (!attachRes.ok) {
    throw new Error(`Failed to attach policy to role (${attachRes.status})`);
  }
  return policy.id;
}

async function grantMatrixAction(
  tenantId: string,
  input: {
    roleId: string;
    roleName: string;
    resource: string;
    action: MatrixAction;
    cell: MatrixCell;
  },
  rolePrimaryPolicyIds: Record<string, string>,
): Promise<void> {
  if (matrixCellHasAction(input.cell, input.action)) return;

  const policyId = await resolvePolicyIdForRole(
    tenantId,
    input.roleId,
    input.roleName,
    rolePrimaryPolicyIds,
  );

  const res = await adminFetch("/admin/permissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      policyId,
      resource: input.resource,
      action: input.action,
      fields: [],
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create permission (${res.status})`);
  }
  toast.success(`${input.action} auf ${input.resource} vergeben.`);
}

async function revokeMatrixAction(
  tenantId: string,
  input: {
    resource: string;
    action: MatrixAction;
    cell: MatrixCell;
  },
): Promise<void> {
  const grant = matrixCellGrantForAction(input.cell, input.action);
  if (!grant) {
    throw new Error("No permission found to remove.");
  }

  const manageGrant = input.cell.grants.MANAGE;
  const isManageWildcard =
    manageGrant !== undefined && grant.permissionId === manageGrant.permissionId;

  if (isManageWildcard) {
    await deletePermission(tenantId, grant.permissionId);
    const policyId = grant.policyId;
    for (const action of MATRIX_ACTIONS) {
      if (action === input.action) continue;
      if (!matrixCellHasAction(input.cell, action)) continue;
      await createPermission(tenantId, {
        policyId,
        resource: input.resource,
        action,
      });
    }
  } else {
    await deletePermission(tenantId, grant.permissionId);
  }
  toast.success(`${input.action} auf ${input.resource} entzogen.`);
}

async function deletePermission(_tenantId: string, permissionId: string): Promise<void> {
  const res = await adminFetch(`/admin/permissions/${permissionId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(`Failed to delete permission (${res.status})`);
  }
}

async function createPermission(
  tenantId: string,
  body: { policyId: string; resource: string; action: MatrixAction },
): Promise<void> {
  const res = await adminFetch("/admin/permissions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, fields: [] }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create permission (${res.status})`);
  }
}
