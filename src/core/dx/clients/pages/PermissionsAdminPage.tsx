/**
 * `/admin/permissions` — Prisma-backed Permission CRUD (CF.MTPERM,
 * iter-128). Enhanced in Issue #84 with a permission matrix summary
 * card above the create form. The matrix is fetched from
 * `GET /admin/permissions/matrix.json` and renders a collapsible
 * resource × role table so operators can see the full permission
 * landscape at a glance.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

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

interface PermissionRecord {
  id: string;
  policyId: string;
  resource: string;
  action: "CREATE" | "READ" | "UPDATE" | "DELETE" | "SHARE";
  fields: string[];
}

interface MatrixCell {
  actions: string[];
}

interface MatrixResponse {
  resources: string[];
  roleIds: string[];
  matrix: Record<string, Record<string, MatrixCell>>;
}

interface RoleRecord {
  id: string;
  name: string;
}

const ALLOWED_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "SHARE"] as const;

export function PermissionsAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [policyId, setPolicyId] = useState("");
  const [resource, setResource] = useState("");
  const [action, setAction] = useState<(typeof ALLOWED_ACTIONS)[number]>("READ");
  const [fields, setFields] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [matrixOpen, setMatrixOpen] = useState(true);

  const list = useQuery({
    queryKey: ["admin", "permissions"],
    queryFn: () => fetchJson<PermissionRecord[]>("/admin/permissions"),
  });

  const matrix = useQuery({
    queryKey: ["admin", "permissions", "matrix", tenantId],
    queryFn: async () => {
      const res = await fetch("/admin/permissions/matrix.json", {
        headers: { accept: "application/json", "x-tenant-id": tenantId },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`matrix load failed (${res.status})`);
      return (await res.json()) as MatrixResponse;
    },
    // Requires a valid-looking tenant ID to avoid a guaranteed 400.
    enabled: tenantId.trim().length > 0,
  });

  const roles = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => fetchJson<RoleRecord[]>("/admin/roles"),
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/admin/permissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policyId,
          resource,
          action,
          fields: fields
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(`permission create failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Permission ${action} ${resource} angelegt.`);
      setResource("");
      setFields("");
      qc.invalidateQueries({ queryKey: ["admin", "permissions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/admin/permissions/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`permission delete failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Permission gelöscht.");
      qc.invalidateQueries({ queryKey: ["admin", "permissions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Build a roleId → name map from the roles list for rendering matrix headers.
  const roleNameMap = new Map((roles.data ?? []).map((r) => [r.id, r.name]));

  return (
    <AdminShell
      title="Permissions"
      subtitle="Action × Resource grants attached to a Policy"
      currentNav="permissions-crud"
    >
      <div className="space-y-4">
        {/* Berechtigungsmatrix */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Berechtigungsmatrix (alle Rollen × Ressourcen)</CardTitle>
              <button
                type="button"
                className="text-xs text-fg-muted hover:text-fg"
                onClick={() => setMatrixOpen((o) => !o)}
              >
                {matrixOpen ? "Einklappen" : "Ausklappen"}
              </button>
            </div>
          </CardHeader>
          {matrixOpen ? (
            <CardContent>
              <div className="mb-3 flex items-end gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="matrix-tenant">Tenant-UUID für Matrix</Label>
                  <Input
                    id="matrix-tenant"
                    value={tenantId}
                    onChange={(e) => setTenantId(e.target.value)}
                    className="w-72"
                    placeholder="UUID eingeben…"
                  />
                </div>
              </div>
              {tenantId.trim().length === 0 ? (
                <PageEmpty>Tenant-UUID eingeben, um die Berechtigungsmatrix zu laden.</PageEmpty>
              ) : matrix.isPending ? (
                <PageLoading>Lade Berechtigungsmatrix…</PageLoading>
              ) : matrix.isError ? (
                <PageError>Konnte Berechtigungsmatrix nicht laden.</PageError>
              ) : (matrix.data?.resources ?? []).length === 0 ? (
                <PageEmpty>Noch keine Berechtigungen definiert.</PageEmpty>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[8rem]">Ressource</TableHead>
                        {matrix.data?.roleIds.map((rid) => (
                          <TableHead key={rid} className="min-w-[6rem] text-xs">
                            {roleNameMap.get(rid) ?? rid.slice(0, 8)}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {matrix.data?.resources.map((res) => (
                        <TableRow key={res}>
                          <TableCell className="font-medium">{res}</TableCell>
                          {matrix.data?.roleIds.map((rid) => {
                            const cell = matrix.data?.matrix[res]?.[rid];
                            const actions = cell?.actions ?? [];
                            return (
                              <TableCell key={rid} className="text-xs text-fg-muted">
                                {actions.length === 0 ? "—" : actions.join(", ")}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Neue Permission</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (policyId.trim() && resource.trim()) create.mutate();
              }}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor="perm-policy">Policy-ID</Label>
                <Input
                  id="perm-policy"
                  value={policyId}
                  onChange={(e) => setPolicyId(e.target.value)}
                  className="w-72"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="perm-resource">Resource</Label>
                <Input
                  id="perm-resource"
                  value={resource}
                  onChange={(e) => setResource(e.target.value)}
                  className="w-48"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="perm-action">Action</Label>
                <Select
                  value={action}
                  onValueChange={(v) => setAction(v as (typeof ALLOWED_ACTIONS)[number])}
                >
                  <SelectTrigger id="perm-action" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ALLOWED_ACTIONS.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label htmlFor="perm-fields">Fields (CSV; leer = alle)</Label>
                <Input
                  id="perm-fields"
                  value={fields}
                  onChange={(e) => setFields(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                disabled={create.isPending || !policyId.trim() || !resource.trim()}
                data-action="create-permission"
              >
                {create.isPending ? "Anlegen…" : "Anlegen"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {list.isPending ? (
          <PageLoading>Lade Permissions…</PageLoading>
        ) : list.isError ? (
          <PageError>Konnte /admin/permissions nicht laden.</PageError>
        ) : (list.data ?? []).length === 0 ? (
          <PageEmpty>Noch keine Permissions angelegt.</PageEmpty>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Permissions ({list.data?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Resource</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Fields</TableHead>
                    <TableHead className="text-right">Aktion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data?.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}…</TableCell>
                      <TableCell className="font-mono text-xs">{p.policyId.slice(0, 8)}…</TableCell>
                      <TableCell>{p.resource}</TableCell>
                      <TableCell>{p.action}</TableCell>
                      <TableCell className="text-xs text-fg-muted">
                        {p.fields.length === 0 ? "(alle)" : p.fields.join(", ")}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={remove.isPending}
                          onClick={() => {
                            if (
                              typeof window !== "undefined" &&
                              !window.confirm(`Permission ${p.action} ${p.resource} löschen?`)
                            )
                              return;
                            remove.mutate(p.id);
                          }}
                          data-action="delete-permission"
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
