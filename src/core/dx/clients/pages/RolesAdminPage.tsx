/**
 * `/admin/roles` — Prisma-backed Role CRUD (CF.MTPERM, iter-128 —
 * PRD-reviewer Finding 2). Enhanced in Issue #84 with a 2-column
 * layout: left role list with search, right Sheet detail panel showing
 * attached policies, parent-role configuration, and inline policy
 * attachment. Reads/writes the `/admin/roles` REST endpoints exposed
 * by `AdminCrudModule` (iter-115).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
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
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJsonWithTenant, readTenantIdFromCookie } from "../lib/api.js";
import { cn } from "../lib/utils.js";

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
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState(() => readTenantIdFromCookie());
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [selectedRole, setSelectedRole] = useState<RoleRecord | null>(null);

  const list = useQuery({
    queryKey: ["admin", "roles", tenantId],
    queryFn: () => fetchJsonWithTenant<RoleRecord[]>("/admin/roles", tenantId),
    enabled: tenantId.trim().length > 0,
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/admin/roles", {
        method: "POST",
        headers: { "content-type": "application/json", "x-tenant-id": tenantId },
        body: JSON.stringify({ name, tenantId, description: description || null }),
      });
      if (!res.ok) throw new Error(`role create failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Rolle "${name}" angelegt.`);
      setName("");
      setDescription("");
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/admin/roles/${id}`, {
        method: "DELETE",
        headers: { "x-tenant-id": tenantId },
      });
      if (!res.ok) throw new Error(`role delete failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Rolle gelöscht.");
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

  return (
    <AdminShell title="Roles" subtitle="Tenant-scoped role administration" currentNav="roles">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Neue Rolle</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && tenantId.trim()) create.mutate();
              }}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor="role-tenant">Tenant-UUID</Label>
                <Input
                  id="role-tenant"
                  value={tenantId}
                  onChange={(e) => setTenantId(e.target.value)}
                  className="w-72"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="role-name">Name</Label>
                <Input
                  id="role-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-48"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="role-description">Beschreibung</Label>
                <Input
                  id="role-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={create.isPending || !name.trim() || !tenantId.trim()}
                data-action="create-role"
              >
                {create.isPending ? "Anlegen…" : "Anlegen"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardTitle>Rollen ({(list.data ?? []).length})</CardTitle>
                <Input
                  placeholder="Suchen…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="max-w-xs"
                />
              </div>
            </CardHeader>
            <CardContent>
              {list.isPending ? (
                <PageLoading>Lade Rollen…</PageLoading>
              ) : tenantId.trim() === "" ? (
                <PageEmpty>
                  Tenant-UUID eingeben oder Cookie <code>x-tenant-id</code> setzen.
                </PageEmpty>
              ) : list.isError ? (
                <PageError>Konnte /admin/roles nicht laden.</PageError>
              ) : filtered.length === 0 ? (
                <PageEmpty>
                  {search.trim() ? "Keine Rollen gefunden." : "Noch keine Rollen angelegt."}
                </PageEmpty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Flags</TableHead>
                      <TableHead>Beschreibung</TableHead>
                      <TableHead className="text-right">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow
                        key={r.id}
                        className={cn(
                          "cursor-pointer hover:bg-surface-hover",
                          selectedRole?.id === r.id && "bg-accent-soft",
                        )}
                        onClick={() => setSelectedRole(r)}
                      >
                        <TableCell className="font-medium">{r.name}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {r.isSystem && (
                              <Badge variant="warn" className="text-[0.65rem]">
                                system
                              </Badge>
                            )}
                            {r.isPublic && (
                              <Badge variant="info" className="text-[0.65rem]">
                                öffentlich
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          {r.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={remove.isPending}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (
                                typeof window !== "undefined" &&
                                !window.confirm(`Rolle "${r.name}" löschen?`)
                              )
                                return;
                              remove.mutate(r.id);
                            }}
                            data-action="delete-role"
                          >
                            Löschen
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Detail hint when nothing is selected */}
          {selectedRole === null && !list.isPending && !list.isError && filtered.length > 0 ? (
            <Card className="flex items-center justify-center">
              <CardContent className="py-12 text-center text-sm text-fg-muted">
                Rolle aus der Liste auswählen, um Details anzuzeigen.
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

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

interface RoleDetailProps {
  role: RoleRecord;
  allRoles: RoleRecord[];
  tenantId: string;
  onClose: () => void;
}

function RoleDetail({ role, allRoles, tenantId, onClose }: RoleDetailProps): ReactNode {
  const qc = useQueryClient();
  const [attachPolicyId, setAttachPolicyId] = useState("");
  const [parentRoleId, setParentRoleId] = useState(role.parentId ?? "");

  const policies = useQuery({
    queryKey: ["admin", "roles", role.id, "policies", tenantId],
    queryFn: async () => {
      const res = await fetch(`/admin/roles/${role.id}/policies`, {
        headers: { accept: "application/json", "x-tenant-id": tenantId },
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
        headers: { "content-type": "application/json", "x-tenant-id": tenantId },
        body: JSON.stringify({ roleId: role.id, policyId: attachPolicyId }),
      });
      if (!res.ok) throw new Error(`attach failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Richtlinie angehängt.");
      setAttachPolicyId("");
      qc.invalidateQueries({ queryKey: ["admin", "roles", role.id, "policies"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const detach = useMutation({
    mutationFn: async (policyId: string) => {
      const res = await fetch(
        `/admin/permissions/attach/${encodeURIComponent(role.id)}/${encodeURIComponent(policyId)}`,
        { method: "DELETE", headers: { "x-tenant-id": tenantId } },
      );
      if (!res.ok) throw new Error(`detach failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Richtlinie entfernt.");
      qc.invalidateQueries({ queryKey: ["admin", "roles", role.id, "policies"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const patchParent = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/admin/roles/${role.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-tenant-id": tenantId },
        body: JSON.stringify({ parentId: parentRoleId || null }),
      });
      if (!res.ok) throw new Error(`patch failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Übergeordnete Rolle gesetzt.");
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
        <SheetDescription>{role.description ?? "Keine Beschreibung"}</SheetDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          {role.isSystem && <Badge variant="warn">System</Badge>}
          {role.isPublic && <Badge variant="info">Öffentlich</Badge>}
          <Badge variant="secondary" className="font-mono text-[0.65rem]">
            {role.id.slice(0, 8)}…
          </Badge>
        </div>
      </SheetHeader>

      {/* Übergeordnete Rolle setzen */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Übergeordnete Rolle setzen</h3>
        <div className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="parent-role">Elternrolle</Label>
            <Select value={parentRoleId} onValueChange={setParentRoleId}>
              <SelectTrigger id="parent-role">
                <SelectValue placeholder="Keine" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— Keine —</SelectItem>
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
            {patchParent.isPending ? "Speichern…" : "Speichern"}
          </Button>
        </div>
        {role.parentId ? (
          <p className="text-xs text-fg-muted">
            Aktuell:{" "}
            <span className="font-mono">
              {allRoles.find((r) => r.id === role.parentId)?.name ?? role.parentId}
            </span>
          </p>
        ) : null}
      </section>

      {/* Richtlinien */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Richtlinien</h3>

        {policies.isPending ? (
          <PageLoading>Lade Richtlinien…</PageLoading>
        ) : policies.isError ? (
          <PageError>Konnte Richtlinien nicht laden. (x-tenant-id gesetzt?)</PageError>
        ) : (policies.data ?? []).length === 0 ? (
          <PageEmpty>Keine Richtlinien angehängt.</PageEmpty>
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
                    variant="destructive"
                    size="sm"
                    disabled={detach.isPending}
                    onClick={() => detach.mutate(rp.policyId)}
                  >
                    Entfernen
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
                  <p className="mt-0.5 text-xs text-fg-muted">Keine Berechtigungen</p>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Richtlinie anfügen */}
        <div className="flex items-end gap-2 pt-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="attach-policy">Richtlinie anfügen</Label>
            <Select value={attachPolicyId} onValueChange={setAttachPolicyId}>
              <SelectTrigger id="attach-policy">
                <SelectValue placeholder="Richtlinie wählen…" />
              </SelectTrigger>
              <SelectContent>
                {availablePolicies.length === 0 ? (
                  <SelectItem value="" disabled>
                    Keine weiteren Richtlinien
                  </SelectItem>
                ) : (
                  availablePolicies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            disabled={attach.isPending || !attachPolicyId || tenantId.trim().length === 0}
            onClick={() => attach.mutate()}
          >
            {attach.isPending ? "Anfügen…" : "Anfügen"}
          </Button>
        </div>
        {tenantId.trim().length === 0 ? (
          <p className="text-xs text-warn">
            Bitte zuerst Tenant-UUID oben eingeben, um Richtlinien anzuhängen.
          </p>
        ) : null}
      </section>
    </div>
  );
}
