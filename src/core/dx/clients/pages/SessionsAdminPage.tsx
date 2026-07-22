/**
 * `/hub/admin/sessions` — Sessions admin (CF.AUTH.SESSIONS). Lists every
 * session known to the wired storage adapter with single-revoke and
 * bulk-by-user actions via `/hub/admin/sessions/*` dev-operator endpoints
 * (CASL `delete:Session` — sign in via Better-Auth first).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { SortableTableHead } from "../components/SortableTableHead.js";
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
import { adminFetch, fetchJson, needsAdminAuthHint } from "../lib/api.js";
import { useTableSort } from "../lib/use-table-sort.js";

interface SessionRecord {
  id: string;
  userId: string;
  createdAt?: string | null;
}

async function deleteSession(id: string): Promise<void> {
  const res = await adminFetch(`/hub/admin/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`revoke failed with status ${res.status}`);
}

async function bulkRevokeByUser(userId: string): Promise<{ revoked: number }> {
  const res = await adminFetch("/hub/admin/sessions/revoke-bulk-by-user", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!res.ok) throw new Error(`bulk-revoke failed with status ${res.status}`);
  return res.json() as Promise<{ revoked: number }>;
}

export function SessionsAdminPage(): ReactNode {
  const qc = useQueryClient();
  const [bulkUserId, setBulkUserId] = useState("");

  const query = useQuery({
    queryKey: ["admin", "sessions"],
    queryFn: () => fetchJson<{ sessions: SessionRecord[] }>("/hub/admin/sessions/list.json"),
  });

  const revoke = useMutation({
    mutationFn: deleteSession,
    onSuccess: (_d, id) => {
      toast.success(`Session ${id} revoked.`);
      qc.invalidateQueries({ queryKey: ["admin", "sessions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const sessions = query.data?.sessions ?? [];
  const { sortedRows: sortedSessions, sortKey, sortDirection, toggleSort } = useTableSort(sessions);

  const bulk = useMutation({
    mutationFn: bulkRevokeByUser,
    onSuccess: (data) => {
      toast.success(`${data.revoked} session(s) revoked.`);
      setBulkUserId("");
      qc.invalidateQueries({ queryKey: ["admin", "sessions"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <AdminShell title="Sessions" subtitle="View and end active sign-ins" currentNav="sessions">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Bulk revoke by user</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (bulkUserId.trim().length > 0) bulk.mutate(bulkUserId.trim());
              }}
            >
              <div className="flex-1 min-w-[16rem] space-y-1">
                <Label htmlFor="sessions-bulk-userid">User ID</Label>
                <Input
                  id="sessions-bulk-userid"
                  value={bulkUserId}
                  onChange={(e) => setBulkUserId(e.target.value)}
                  aria-label="user uuid"
                />
              </div>
              <Button type="submit" disabled={bulk.isPending || bulkUserId.trim().length === 0}>
                {bulk.isPending ? "Revoking…" : "Revoke all"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {query.isPending ? (
          <PageLoading>Loading sessions…</PageLoading>
        ) : query.isError ? (
          <PageError showAuthHint={needsAdminAuthHint(query.error)}>
            Failed to load /hub/admin/sessions/list.json
          </PageError>
        ) : (query.data?.sessions ?? []).length === 0 ? (
          <PageEmpty>No active sessions returned by the storage adapter.</PageEmpty>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Sessions ({query.data?.sessions.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTableHead
                      label="Session ID"
                      sortKey="id"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="User ID"
                      sortKey="userId"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <SortableTableHead
                      label="Created"
                      sortKey="createdAt"
                      activeSortKey={sortKey}
                      sortDirection={sortDirection}
                      onSort={toggleSort}
                    />
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedSessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.id}</TableCell>
                      <TableCell className="font-mono text-xs">{s.userId}</TableCell>
                      <TableCell className="text-xs text-fg-muted">{s.createdAt ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={revoke.isPending}
                          onClick={() => revoke.mutate(s.id)}
                        >
                          Revoke
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
