/**
 * `/hub/admin/policies` — Prisma-backed Policy CRUD (CF.MTPERM, iter-128).
 * Enhanced in Issue #84 with a "Usage" column: a "Show roles"
 * button per policy row fetches `GET /hub/admin/policies/:id/roles` on
 * demand and shows the results in a Dialog.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
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
import { fetchJson } from "../lib/api.js";
import { useTableSort } from "../lib/use-table-sort.js";

interface PermissionLite {
  id: string;
  resource: string;
  action: string;
}

interface PolicyRecord {
  id: string;
  name: string;
  description: string | null;
  permissions?: PermissionLite[];
}

interface RoleLite {
  id: string;
  name: string;
  tenantId: string;
}

interface RolePolicyLink {
  roleId: string;
  policyId: string;
  role: RoleLite;
}

export function PoliciesAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [usagePolicy, setUsagePolicy] = useState<PolicyRecord | null>(null);

  const list = useQuery({
    queryKey: ["admin", "policies"],
    queryFn: () => fetchJson<PolicyRecord[]>("/hub/admin/policies"),
  });

  const create = useMutation({
    mutationFn: async (payload: { name: string; description: string }) => {
      const res = await fetch("/hub/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: payload.name, description: payload.description || null }),
      });
      if (!res.ok) throw new Error(`policy create failed (${res.status})`);
      return res.json();
    },
    onSuccess: (_data, payload) => {
      toast.success(`Policy "${payload.name}" created.`);
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["admin", "policies"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/hub/admin/policies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`policy delete failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Policy deleted.");
      qc.invalidateQueries({ queryKey: ["admin", "policies"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const policies = list.data ?? [];
  const {
    sortedRows: sortedPolicies,
    sortKey,
    sortDirection,
    toggleSort,
  } = useTableSort(policies, {
    getValue: (row, key) => {
      if (key === "permissions") return row.permissions?.length ?? 0;
      return (row as Record<string, unknown>)[key];
    },
  });

  return (
    <AdminShell
      title="Policies"
      subtitle="Manage permission bundles and assign roles"
      currentNav="policies"
    >
      <div className="space-y-4">
        {list.isPending ? (
          <PageLoading>Loading policies…</PageLoading>
        ) : list.isError ? (
          <PageError>Could not load /hub/admin/policies.</PageError>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Policies ({policies.length})</CardTitle>
                <Button
                  size="sm"
                  onClick={() => setCreateOpen(true)}
                  data-action="create-policy-open"
                >
                  New policy
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {policies.length === 0 ? (
                <PageEmpty>No policies created yet.</PageEmpty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead
                        label="ID"
                        sortKey="id"
                        activeSortKey={sortKey}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      />
                      <SortableTableHead
                        label="Name"
                        sortKey="name"
                        activeSortKey={sortKey}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      />
                      <SortableTableHead
                        label="Description"
                        sortKey="description"
                        activeSortKey={sortKey}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      />
                      <SortableTableHead
                        label="Permissions"
                        sortKey="permissions"
                        activeSortKey={sortKey}
                        sortDirection={sortDirection}
                        onSort={toggleSort}
                      />
                      <TableHead>Usage</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPolicies.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}…</TableCell>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          {p.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{p.permissions?.length ?? 0}</TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => setUsagePolicy(p)}>
                            Show roles
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (
                                typeof window !== "undefined" &&
                                !window.confirm(`Policy "${p.name}" delete?`)
                              )
                                return;
                              remove.mutate(p.id);
                            }}
                            data-action="delete-policy"
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <CreatePolicyDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        isPending={create.isPending}
        onCreate={(payload) => create.mutate(payload)}
      />

      <Dialog
        open={usagePolicy !== null}
        onOpenChange={(open) => {
          if (!open) setUsagePolicy(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Roles for policy „{usagePolicy?.name}"</DialogTitle>
            <DialogDescription>
              These roles use the policy directly via a RolePolicy entry.
            </DialogDescription>
          </DialogHeader>
          {usagePolicy ? <PolicyRolesPanel policyId={usagePolicy.id} /> : null}
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

interface CreatePolicyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isPending: boolean;
  onCreate: (payload: { name: string; description: string }) => void;
}

function CreatePolicyDialog({
  open,
  onOpenChange,
  isPending,
  onCreate,
}: CreatePolicyDialogProps): ReactNode {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New policy</DialogTitle>
          <DialogDescription>
            Creates a permission bundle that can be attached to roles.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate({ name: name.trim(), description: description.trim() });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="policy-name">Name</Label>
            <Input
              id="policy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="policy-description">Description</Label>
            <Input
              id="policy-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()} data-action="create-policy">
              {isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PolicyRolesPanel({ policyId }: { policyId: string }): ReactNode {
  const roles = useQuery({
    queryKey: ["admin", "policies", policyId, "roles"],
    queryFn: () => fetchJson<RolePolicyLink[]>(`/hub/admin/policies/${policyId}/roles`),
  });
  const { sortedRows, sortKey, sortDirection, toggleSort } = useTableSort(roles.data ?? [], {
    getValue: (row, key) => {
      if (key === "name") return row.role.name;
      if (key === "tenantId") return row.role.tenantId;
      return (row as Record<string, unknown>)[key];
    },
  });

  if (roles.isPending) return <PageLoading>Loading roles…</PageLoading>;
  if (roles.isError) return <PageError>Could not load roles.</PageError>;
  if ((roles.data ?? []).length === 0) return <PageEmpty>No roles use this policy.</PageEmpty>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableTableHead
            label="Name"
            sortKey="name"
            activeSortKey={sortKey}
            sortDirection={sortDirection}
            onSort={toggleSort}
          />
          <SortableTableHead
            label="Tenant"
            sortKey="tenantId"
            activeSortKey={sortKey}
            sortDirection={sortDirection}
            onSort={toggleSort}
          />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedRows.map((rp) => (
          <TableRow key={rp.roleId}>
            <TableCell>{rp.role.name}</TableCell>
            <TableCell className="font-mono text-xs text-fg-muted">
              {rp.role.tenantId.slice(0, 8)}…
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
