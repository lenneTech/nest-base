/**
 * `/admin/roles` — Prisma-backed Role CRUD (CF.MTPERM, iter-128 —
 * PRD-reviewer Finding 2). Reads/writes the `/admin/roles` REST
 * endpoints exposed by `AdminCrudModule` (iter-115). Permission
 * gating is enforced by the controller's CASL decorators; the SPA
 * is a thin form-driven view over the same surface.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
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

interface RoleRecord {
  id: string;
  name: string;
  tenantId: string;
  description: string | null;
  isSystem: boolean;
  isPublic: boolean;
}

export function RolesAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [description, setDescription] = useState("");

  const list = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => fetchJson<RoleRecord[]>("/admin/roles"),
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
      qc.invalidateQueries({ queryKey: ["admin", "roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

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

        {list.isPending ? (
          <PageLoading>Lade Rollen…</PageLoading>
        ) : list.isError ? (
          <PageError>Konnte /admin/roles nicht laden.</PageError>
        ) : (list.data ?? []).length === 0 ? (
          <PageEmpty>Noch keine Rollen angelegt.</PageEmpty>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Rollen ({list.data?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Tenant</TableHead>
                    <TableHead>Beschreibung</TableHead>
                    <TableHead className="text-right">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data?.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}…</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell className="font-mono text-xs">{r.tenantId.slice(0, 8)}…</TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {r.description ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={remove.isPending}
                          onClick={() => {
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
            </CardContent>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
