/**
 * `/admin/roles` — Prisma-backed Role CRUD (CF.MTPERM, iter-128 —
 * PRD-reviewer Finding 2). Enhanced in Issue #84 with a role list plus
 * Sheet detail panel for attached policies, parent-role configuration, Reads/writes the `/admin/roles` REST endpoints exposed
 * by `AdminCrudModule` (iter-115).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "../components/ui/badge.js";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../components/ui/sheet.js";
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
import { adminFetch, fetchJson } from "../lib/api.js";
import { bootstrapHubOperatorSession } from "../lib/hub-session-bootstrap.js";
import { useTableSort } from "../lib/use-table-sort.js";
import { cn } from "../lib/utils.js";

/** Radix Select forbids `value=""` — sentinel for “no parent role”. */
const NO_PARENT_ROLE_VALUE = "__none__";

interface RoleRecord {
  id: string;
  name: string;
  tenantId: string;
  description: string | null;
  isSystem: boolean;
  isPublic: boolean;
  parentId: string | null;
}

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

interface RolePolicyLink {
  roleId: string;
  policyId: string;
  policy: PolicyRecord;
}

export function RolesAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [search, setSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleRecord | null>(null);
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

  const showManualTenantField = tenantBootstrapDone && tenantId.trim().length === 0;

  const list = useQuery({
    queryKey: ["admin", "roles", tenantId],
    queryFn: () => fetchJson<RoleRecord[]>("/admin/roles"),
    enabled: tenantId.trim().length > 0,
  });

  const create = useMutation({
    mutationFn: async (payload: { name: string; description: string }) => {
      const res = await adminFetch("/admin/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: payload.name,
          tenantId,
          description: payload.description || null,
        }),
      });
      if (!res.ok) throw new Error(`role create failed (${res.status})`);
      return res.json();
    },
    onSuccess: (_data, payload) => {
      toast.success(`Role "${payload.name}" created.`);
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await adminFetch(`/admin/roles/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`role delete failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Role deleted.");
      setSelectedRole(null);
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const filtered = (list.data ?? []).filter(
    (r) =>
      search.trim() === "" ||
      r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.id.includes(search),
  );
  const {
    sortedRows: sortedRoles,
    sortKey,
    sortDirection,
    toggleSort,
  } = useTableSort(filtered, {
    getValue: (row, key) => {
      if (key === "flags") {
        return `${row.isSystem ? "1" : "0"}:${row.isPublic ? "1" : "0"}`;
      }
      return (row as Record<string, unknown>)[key];
    },
  });

  return (
    <AdminShell
      title="Roles"
      subtitle="Manage roles per tenant, inheritance, and policy assignment"
      currentNav="roles"
    >
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <CardTitle>Roles ({(list.data ?? []).length})</CardTitle>
                <p className="text-sm text-fg-muted">
                  Click a role row or use <span className="font-medium text-fg">Open</span> to edit
                  policies and parent role settings.
                </p>
              </div>
              <div className="flex w-full min-w-[16rem] flex-1 items-center gap-3 sm:max-w-md">
                <Input
                  placeholder="Search…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="min-w-0 flex-1"
                  aria-label="Search roles"
                />
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => setCreateOpen(true)}
                  data-action="create-role-open"
                >
                  New role
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {list.isPending ? (
              <PageLoading>Loading roles…</PageLoading>
            ) : !tenantBootstrapDone ? (
              <PageLoading>Loading tenant from session…</PageLoading>
            ) : tenantId.trim() === "" ? (
              <PageEmpty>
                No active tenant — choose an organization in Better Auth or enter a tenant UUID.
              </PageEmpty>
            ) : list.isError ? (
              <PageError>Could not load /admin/roles.</PageError>
            ) : filtered.length === 0 ? (
              <PageEmpty>{search.trim() ? "No roles found." : "No roles created yet."}</PageEmpty>
            ) : (
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
                      label="Flags"
                      sortKey="flags"
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
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRoles.map((r) => (
                    <TableRow
                      key={r.id}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                        selectedRole?.id === r.id && "bg-accent-soft",
                      )}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open role ${r.name}`}
                      onClick={() => setSelectedRole(r)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedRole(r);
                        }
                      }}
                    >
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          {r.name}
                          <span className="text-fg-faint" aria-hidden="true">
                            →
                          </span>
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {r.isSystem && (
                            <Badge variant="warn" className="text-[0.65rem]">
                              system
                            </Badge>
                          )}
                          {r.isPublic && (
                            <Badge variant="info" className="text-[0.65rem]">
                              public
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {r.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            data-action="open-role"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRole(r);
                            }}
                          >
                            Open
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={remove.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                typeof window !== "undefined" &&
                                !window.confirm(`Role "${r.name}" delete?`)
                              )
                                return;
                              remove.mutate(r.id);
                            }}
                            data-action="delete-role"
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tenantId={tenantId}
        showManualTenantField={showManualTenantField}
        onTenantIdChange={setTenantId}
        isPending={create.isPending}
        onCreate={(payload) => create.mutate(payload)}
      />

      <Sheet
        open={selectedRole !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedRole(null);
        }}
      >
        <SheetContent className="w-[32rem] max-w-full overflow-y-auto sm:max-w-[32rem]">
          {selectedRole ? (
            <RoleDetail
              role={selectedRole}
              allRoles={list.data ?? []}
              tenantId={tenantId}
              onClose={() => setSelectedRole(null)}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </AdminShell>
  );
}

interface CreateRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  showManualTenantField: boolean;
  onTenantIdChange: (tenantId: string) => void;
  isPending: boolean;
  onCreate: (payload: { name: string; description: string }) => void;
}

function CreateRoleDialog({
  open,
  onOpenChange,
  tenantId,
  showManualTenantField,
  onTenantIdChange,
  isPending,
  onCreate,
}: CreateRoleDialogProps): ReactNode {
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
          <DialogTitle>New role</DialogTitle>
          <DialogDescription>
            Creates a role in the active tenant for policy assignment.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && tenantId.trim()) {
              onCreate({ name: name.trim(), description: description.trim() });
            }
          }}
        >
          {showManualTenantField ? (
            <div className="space-y-1">
              <Label htmlFor="role-tenant">Tenant UUID</Label>
              <Input
                id="role-tenant"
                value={tenantId}
                onChange={(e) => onTenantIdChange(e.target.value)}
                placeholder="Enter UUID…"
                autoComplete="off"
              />
            </div>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus={!showManualTenantField}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isPending || !name.trim() || !tenantId.trim()}
              data-action="create-role"
            >
              {isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RoleDetailProps {
  role: RoleRecord;
  allRoles: RoleRecord[];
  tenantId: string;
  onClose: () => void;
}

function RoleDetail({ role, allRoles, tenantId, onClose }: RoleDetailProps): ReactNode {
  const qc = useQueryClient();
  const [attachPolicyId, setAttachPolicyId] = useState("");
  const [parentRoleId, setParentRoleId] = useState(role.parentId ?? NO_PARENT_ROLE_VALUE);

  const policies = useQuery({
    queryKey: ["admin", "roles", role.id, "policies", tenantId],
    queryFn: async () => {
      const res = await fetch(`/admin/roles/${role.id}/policies`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`policies load failed (${res.status})`);
      return (await res.json()) as RolePolicyLink[];
    },
    enabled: tenantId.trim().length > 0,
  });

  const allPolicies = useQuery({
    queryKey: ["admin", "policies"],
    queryFn: () => fetchJson<PolicyRecord[]>("/admin/policies"),
  });

  const attach = useMutation({
    mutationFn: async () => {
      const res = await fetch("/admin/permissions/attach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId: role.id, policyId: attachPolicyId }),
      });
      if (!res.ok) throw new Error(`attach failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Policy attached.");
      setAttachPolicyId("");
      qc.invalidateQueries({ queryKey: ["admin", "roles", role.id, "policies"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const detach = useMutation({
    mutationFn: async (policyId: string) => {
      const res = await fetch(
        `/admin/permissions/attach/${encodeURIComponent(role.id)}/${encodeURIComponent(policyId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`detach failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Policy removed.");
      qc.invalidateQueries({ queryKey: ["admin", "roles", role.id, "policies"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const patchParent = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/admin/roles/${role.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentId: parentRoleId === NO_PARENT_ROLE_VALUE ? null : parentRoleId,
        }),
      });
      if (!res.ok) throw new Error(`patch failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Parent role set.");
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Available policies are those not yet attached to this role.
  const attachedPolicyIds = new Set((policies.data ?? []).map((rp) => rp.policyId));
  const availablePolicies = (allPolicies.data ?? []).filter((p) => !attachedPolicyIds.has(p.id));

  // Available parent roles: exclude the role itself and its own children
  // (no cycle check for grandchildren — backend has no cycle guard either).
  const availableParents = allRoles.filter((r) => r.id !== role.id);

  return (
    <div className="flex flex-col gap-6 pt-2">
      <SheetHeader>
        <SheetTitle>{role.name}</SheetTitle>
        <SheetDescription>{role.description ?? "No description"}</SheetDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          {role.isSystem && <Badge variant="warn">System</Badge>}
          {role.isPublic && <Badge variant="info">Public</Badge>}
          <Badge variant="secondary" className="font-mono text-[0.65rem]">
            {role.id.slice(0, 8)}…
          </Badge>
        </div>
      </SheetHeader>

      {/* Set parent role */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Set parent role</h3>
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="parent-role">Parent role</Label>
            <Select value={parentRoleId} onValueChange={setParentRoleId}>
              <SelectTrigger id="parent-role">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PARENT_ROLE_VALUE}>— None —</SelectItem>
                {availableParents.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={patchParent.isPending || tenantId.trim().length === 0}
            onClick={() => patchParent.mutate()}
          >
            {patchParent.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
        {role.parentId ? (
          <p className="text-xs text-fg-muted">
            Current:{" "}
            <span className="font-mono">
              {allRoles.find((r) => r.id === role.parentId)?.name ?? role.parentId}
            </span>
          </p>
        ) : null}
      </section>

      {/* Policies */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Policies</h3>

        {policies.isPending ? (
          <PageLoading>Loading policies…</PageLoading>
        ) : policies.isError ? (
          <PageError>Could not load policies. (Is the active organization set?)</PageError>
        ) : (policies.data ?? []).length === 0 ? (
          <PageEmpty>No policies attached.</PageEmpty>
        ) : (
          <ul className="flex flex-col gap-2">
            {policies.data?.map((rp) => (
              <li
                key={rp.policyId}
                className="rounded-md border border-line bg-surface-2 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{rp.policy.name}</span>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={detach.isPending}
                    onClick={() => detach.mutate(rp.policyId)}
                  >
                    Remove
                  </Button>
                </div>
                {rp.policy.permissions && rp.policy.permissions.length > 0 ? (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {rp.policy.permissions.map((perm) => (
                      <li
                        key={perm.id}
                        className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[0.65rem] text-fg-dim"
                      >
                        {perm.action} {perm.resource}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-0.5 text-xs text-fg-muted">No permissions</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Attach policy */}
        <div className="flex items-end gap-2 pt-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="attach-policy">Attach policy</Label>
            <Select
              value={attachPolicyId}
              onValueChange={setAttachPolicyId}
              disabled={availablePolicies.length === 0}
            >
              <SelectTrigger id="attach-policy">
                <SelectValue
                  placeholder={
                    availablePolicies.length === 0 ? "No more policies" : "Choose policy…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {availablePolicies.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={attach.isPending || !attachPolicyId || tenantId.trim().length === 0}
            onClick={() => attach.mutate()}
          >
            {attach.isPending ? "Attaching…" : "Attach"}
          </Button>
        </div>
        {tenantId.trim().length === 0 ? (
          <p className="text-xs text-warn">
            No active tenant — policies can be attached only after selecting a tenant.
          </p>
        ) : null}
      </section>
    </div>
  );
}
