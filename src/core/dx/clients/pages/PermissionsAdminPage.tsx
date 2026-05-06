/**
 * `/admin/permissions` — Prisma-backed Permission CRUD (CF.MTPERM,
 * iter-128). Reads/writes the `/admin/permissions` REST endpoints
 * from `AdminCrudModule` (iter-115). The page exposes Permission
 * creation under an existing Policy + the role-policy attach link
 * via `POST /admin/permissions/attach`.
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

const ALLOWED_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "SHARE"] as const;

export function PermissionsAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [policyId, setPolicyId] = useState("");
  const [resource, setResource] = useState("");
  const [action, setAction] = useState<(typeof ALLOWED_ACTIONS)[number]>("READ");
  const [fields, setFields] = useState("");

  const list = useQuery({
    queryKey: ["admin", "permissions"],
    queryFn: () => fetchJson<PermissionRecord[]>("/api/admin/permissions"),
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/permissions", {
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

  return (
    <AdminShell
      title="Permissions"
      subtitle="Action × Resource grants attached to a Policy"
      currentNav="permissions"
    >
      <div className="space-y-4">
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
