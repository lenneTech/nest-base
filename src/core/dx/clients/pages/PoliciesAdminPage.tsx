/**
 * `/admin/policies` — Prisma-backed Policy CRUD (CF.MTPERM, iter-128).
 * Enhanced in Issue #84 with a "Verwendung" column: a "Rollen anzeigen"
 * button per policy row fetches `GET /admin/policies/:id/roles` on
 * demand and shows the results in a Dialog.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [usagePolicy, setUsagePolicy] = useState<PolicyRecord | null>(null);

  const list = useQuery({
    queryKey: ["admin", "policies"],
    queryFn: () => fetchJson<PolicyRecord[]>("/api/admin/policies"),
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/policies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description: description || null }),
      });
      if (!res.ok) throw new Error(`policy create failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Policy "${name}" angelegt.`);
      setName("");
      setDescription("");
      qc.invalidateQueries({ queryKey: ["admin", "policies"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/policies/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`policy delete failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Policy gelöscht.");
      qc.invalidateQueries({ queryKey: ["admin", "policies"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <AdminShell title="Policies" subtitle="Permission-bundle administration" currentNav="policies">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Neue Policy</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) create.mutate();
              }}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor="policy-name">Name</Label>
                <Input
                  id="policy-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-72"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="policy-description">Beschreibung</Label>
                <Input
                  id="policy-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={create.isPending || !name.trim()}
                data-action="create-policy"
              >
                {create.isPending ? "Anlegen…" : "Anlegen"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {list.isPending ? (
          <PageLoading>Lade Policies…</PageLoading>
        ) : list.isError ? (
          <PageError>Konnte /admin/policies nicht laden.</PageError>
        ) : (list.data ?? []).length === 0 ? (
          <PageEmpty>Noch keine Policies angelegt.</PageEmpty>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Policies ({list.data?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead>Permissions</TableHead>
                    <TableHead>Verwendung</TableHead>
                    <TableHead className="text-right">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data?.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}…</TableCell>
                      <TableCell>{p.name}</TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {p.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{p.permissions?.length ?? 0}</TableCell>
                      <TableCell>
                        <Button variant="outline" size="sm" onClick={() => setUsagePolicy(p)}>
                          Rollen anzeigen
                        </Button>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              typeof window !== "undefined" &&
                              !window.confirm(`Policy "${p.name}" löschen?`)
                            )
                              return;
                            remove.mutate(p.id);
                          }}
                          data-action="delete-policy"
                        >
                          Löschen
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog
        open={usagePolicy !== null}
        onOpenChange={(open) => {
          if (!open) setUsagePolicy(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Rollen für Policy „{usagePolicy?.name}"</DialogTitle>
            <DialogDescription>
              Diese Rollen verwenden die Richtlinie direkt über einen RolePolicy-Eintrag.
            </DialogDescription>
          </DialogHeader>
          {usagePolicy ? <PolicyRolesPanel policyId={usagePolicy.id} /> : null}
        </DialogContent>
      </Dialog>
    </AdminShell>
  );
}

function PolicyRolesPanel({ policyId }: { policyId: string }): ReactNode {
  const roles = useQuery({
    queryKey: ["admin", "policies", policyId, "roles"],
    queryFn: () => fetchJson<RolePolicyLink[]>(`/api/admin/policies/${policyId}/roles`),
  });

  if (roles.isPending) return <PageLoading>Lade Rollen…</PageLoading>;
  if (roles.isError) return <PageError>Konnte Rollen nicht laden.</PageError>;
  if ((roles.data ?? []).length === 0)
    return <PageEmpty>Keine Rollen verwenden diese Policy.</PageEmpty>;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Tenant</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {roles.data?.map((rp) => (
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
