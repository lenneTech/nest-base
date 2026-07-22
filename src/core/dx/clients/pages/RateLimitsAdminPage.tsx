/**
 * `/hub/admin/rate-limits` — Live rate-limit management for operators (issue #94).
 *
 * Four tabs:
 *   - Inspector: live throttle rows with auto-refresh, endpoint filter,
 *                "blocked only" toggle, and per-key unban action.
 *   - Configuration: per-scope maxRequests + windowSeconds inputs with
 *                    Save / Reset buttons.
 *   - Decisions: sampled decision history table with pagination and
 *                     endpoint / decision type filters.
 *   - Allowlist: user allowlist with add dialog and per-row remove button.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, type ReactNode } from "react";
import { toast } from "sonner";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { SortableTableHead } from "../components/SortableTableHead.js";
import { AdminShell } from "../layout/AdminShell.js";
import { adminFetch, fetchJson, needsAdminAuthHint } from "../lib/api.js";
import { useTableSort } from "../lib/use-table-sort.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InspectorRow {
  key: string;
  count: number;
  expiresAt: string;
  expiresInSeconds: number;
}

interface ConfigScope {
  scope: string;
  maxRequests: number;
  windowSeconds: number;
  isCustom: boolean;
}

interface DecisionRecord {
  id: string;
  bucketKey: string;
  endpoint: string;
  decision: string;
  count: number;
  limit: number;
  windowSecs: number;
  ip: string | null;
  userId: string | null;
  ts: string;
}

interface AllowlistEntry {
  id: string;
  userId: string;
  reason: string;
  createdAt: string;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function RateLimitsAdminPage(): ReactNode {
  return (
    <AdminShell
      title="Rate-Limits"
      subtitle="Live throttle state, configuration, and allowlist"
      currentNav="rate-limits"
    >
      <Tabs defaultValue="inspector">
        <TabsList className="mb-4">
          <TabsTrigger value="inspector">Inspector</TabsTrigger>
          <TabsTrigger value="config">Configuration</TabsTrigger>
          <TabsTrigger value="decisions">Decisions</TabsTrigger>
          <TabsTrigger value="allowlist">Allowlist</TabsTrigger>
        </TabsList>

        <TabsContent value="inspector">
          <InspectorTab />
        </TabsContent>
        <TabsContent value="config">
          <ConfigTab />
        </TabsContent>
        <TabsContent value="decisions">
          <DecisionsTab />
        </TabsContent>
        <TabsContent value="allowlist">
          <AllowlistTab />
        </TabsContent>
      </Tabs>
    </AdminShell>
  );
}

// ─── Inspector tab ────────────────────────────────────────────────────────────

function InspectorTab(): ReactNode {
  const qc = useQueryClient();
  const [scopeFilter, setScopeFilter] = useState("");
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["admin", "rate-limits", "inspector", scopeFilter],
    queryFn: () =>
      fetchJson<{ rows: InspectorRow[]; total: number }>(
        `/hub/admin/rate-limits/inspector.json${scopeFilter ? `?scope=${encodeURIComponent(scopeFilter)}` : ""}`,
      ),
    refetchInterval: 5_000,
  });

  const resetKey = useMutation({
    mutationFn: async (key: string) => {
      const res = await adminFetch(`/hub/admin/rate-limits/keys/${encodeURIComponent(key)}/reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`reset failed (${res.status})`);
      return res.json();
    },
    onSuccess: (_d, key) => {
      toast.success(`Key "${key}" unblocked.`);
      setConfirmKey(null);
      qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "inspector"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = query.data?.rows ?? [];
  const visible = blockedOnly ? rows : rows;
  const {
    sortedRows: sortedVisible,
    sortKey,
    sortDirection,
    toggleSort,
  } = useTableSort(visible, {
    getValue: (row, key) => {
      if (key === "expiresInSeconds") return row.expiresInSeconds;
      return (row as Record<string, unknown>)[key];
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="inspector-scope">Endpoint contains</Label>
              <Input
                id="inspector-scope"
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value)}
                placeholder="e.g. auth:signIn"
                className="w-56"
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={blockedOnly}
                onChange={(e) => setBlockedOnly(e.target.checked)}
                className="rounded"
              />
              Blocked only
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "inspector"] })
              }
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {query.isPending ? (
        <PageLoading>Loading throttle entries…</PageLoading>
      ) : query.isError ? (
        <PageError showAuthHint={needsAdminAuthHint(query.error)}>
          Error loading /hub/admin/rate-limits/inspector.json
        </PageError>
      ) : visible.length === 0 ? (
        <PageEmpty>No active throttle entries found.</PageEmpty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              Active entries ({visible.length} / {query.data?.total ?? 0} total)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead
                    label="Bucket-Key"
                    sortKey="key"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    label="Count"
                    sortKey="count"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableTableHead
                    label="Expires"
                    sortKey="expiresInSeconds"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    align="right"
                  />
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedVisible.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-mono text-xs break-all">{row.key}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right text-xs text-fg-muted">
                      {row.expiresInSeconds}s
                    </TableCell>
                    <TableCell className="text-right">
                      {confirmKey === row.key ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-warn">Really?</span>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={resetKey.isPending}
                            onClick={() => resetKey.mutate(row.key)}
                          >
                            Yes
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirmKey(null)}>
                            No
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirmKey(row.key)}
                        >
                          Unban
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Config tab ───────────────────────────────────────────────────────────────

function ConfigTab(): ReactNode {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["admin", "rate-limits", "config"],
    queryFn: () => fetchJson<{ scopes: ConfigScope[] }>("/hub/admin/rate-limits/config.json"),
  });

  const globalScopes = (query.data?.scopes ?? []).filter((s) => s.scope.startsWith("global:"));
  const authScopes = (query.data?.scopes ?? []).filter((s) => s.scope.startsWith("auth:"));

  return (
    <div className="space-y-4">
      {query.isPending ? (
        <PageLoading>Loading configuration…</PageLoading>
      ) : query.isError ? (
        <PageError showAuthHint={needsAdminAuthHint(query.error)}>
          Error loading /hub/admin/rate-limits/config.json
        </PageError>
      ) : (
        <>
          <ConfigSection
            title="Global windows"
            scopes={globalScopes}
            onChanged={() => qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "config"] })}
          />
          <ConfigSection
            title="Auth endpoints"
            scopes={authScopes}
            onChanged={() => qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "config"] })}
          />
        </>
      )}
    </div>
  );
}

interface ConfigSectionProps {
  title: string;
  scopes: ConfigScope[];
  onChanged: () => void;
}

function ConfigSection({ title, scopes, onChanged }: ConfigSectionProps): ReactNode {
  const { sortedRows, sortKey, sortDirection, toggleSort } = useTableSort(scopes);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTableHead
                label="Scope"
                sortKey="scope"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <SortableTableHead
                label="Max requests"
                sortKey="maxRequests"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <SortableTableHead
                label="Window (s)"
                sortKey="windowSeconds"
                activeSortKey={sortKey}
                sortDirection={sortDirection}
                onSort={toggleSort}
              />
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((scope) => (
              <ConfigRow key={scope.scope} scope={scope} onChanged={onChanged} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface ConfigRowProps {
  scope: ConfigScope;
  onChanged: () => void;
}

function ConfigRow({ scope, onChanged }: ConfigRowProps): ReactNode {
  const [maxRequests, setMaxRequests] = useState(String(scope.maxRequests));
  const [windowSeconds, setWindowSeconds] = useState(String(scope.windowSeconds));

  // Keep local state in sync when the query refreshes
  useEffect(() => {
    setMaxRequests(String(scope.maxRequests));
    setWindowSeconds(String(scope.windowSeconds));
  }, [scope.maxRequests, scope.windowSeconds]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(
        `/hub/admin/rate-limits/config/${encodeURIComponent(scope.scope)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            maxRequests: Number(maxRequests),
            windowSeconds: Number(windowSeconds),
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Save failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Scope "${scope.scope}" saved.`);
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await adminFetch(
        `/hub/admin/rate-limits/config/${encodeURIComponent(scope.scope)}`,
        {
          method: "DELETE",
        },
      );
      if (!res.ok) throw new Error(`Reset failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Scope "${scope.scope}" reset.`);
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        {scope.scope}
        {scope.isCustom && (
          <Badge variant="info" className="ml-2 text-[0.6rem]">
            custom
          </Badge>
        )}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={1}
          max={100000}
          value={maxRequests}
          onChange={(e) => setMaxRequests(e.target.value)}
          className="w-28"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={1}
          max={86400}
          value={windowSeconds}
          onChange={(e) => setWindowSeconds(e.target.value)}
          className="w-28"
        />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {scope.isCustom && (
            <Button
              size="sm"
              variant="secondary"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? "…" : "Reset"}
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Decisions tab ────────────────────────────────────────────────────────────

function DecisionsTab(): ReactNode {
  const [cursor, setCursor] = useState<string | undefined>();
  const [endpointFilter, setEndpointFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");

  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  if (endpointFilter) params.set("endpoint", endpointFilter);
  if (decisionFilter) params.set("decision", decisionFilter);

  const query = useQuery({
    queryKey: ["admin", "rate-limits", "decisions", cursor, endpointFilter, decisionFilter],
    queryFn: () =>
      fetchJson<{
        items: DecisionRecord[];
        nextCursor: string | null;
        total: number;
      }>(`/hub/admin/rate-limits/decisions.json?${params.toString()}`),
  });

  const decisionItems = query.data?.items ?? [];
  const {
    sortedRows: sortedDecisions,
    sortKey,
    sortDirection,
    toggleSort,
  } = useTableSort(decisionItems, {
    getValue: (row, key) => {
      if (key === "ipUser") return row.ip ?? row.userId;
      if (key === "countLimit") return `${row.count}/${row.limit}`;
      return (row as Record<string, unknown>)[key];
    },
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="decisions-endpoint">Endpoint</Label>
              <Input
                id="decisions-endpoint"
                value={endpointFilter}
                onChange={(e) => {
                  setEndpointFilter(e.target.value);
                  setCursor(undefined);
                }}
                placeholder="e.g. auth:signIn"
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="decisions-type">Type</Label>
              <select
                id="decisions-type"
                value={decisionFilter}
                onChange={(e) => {
                  setDecisionFilter(e.target.value);
                  setCursor(undefined);
                }}
                className="h-9 rounded-md border border-line bg-surface px-3 text-sm"
              >
                <option value="">All</option>
                <option value="block">Block</option>
                <option value="allow">Allow</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {query.isPending ? (
        <PageLoading>Loading decisions…</PageLoading>
      ) : query.isError ? (
        <PageError showAuthHint={needsAdminAuthHint(query.error)}>
          Error loading /hub/admin/rate-limits/decisions.json
        </PageError>
      ) : (query.data?.items ?? []).length === 0 ? (
        <PageEmpty>No decisions found.</PageEmpty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Decisions ({query.data?.total ?? 0} total)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead
                    label="Time"
                    sortKey="ts"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    label="Endpoint"
                    sortKey="endpoint"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    label="Type"
                    sortKey="decision"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    label="Count / Limit"
                    sortKey="count"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                    align="right"
                  />
                  <SortableTableHead
                    label="IP / User"
                    sortKey="ipUser"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDecisions.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                      {new Date(r.ts).toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{r.endpoint}</TableCell>
                    <TableCell>
                      <Badge variant={r.decision === "block" ? "destructive" : "secondary"}>
                        {r.decision}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {r.count}/{r.limit}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-fg-muted">
                      {r.ip ?? r.userId ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {query.data?.nextCursor && (
              <div className="mt-3 flex justify-center">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCursor(query.data?.nextCursor ?? undefined)}
                >
                  Load more
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Allowlist tab ────────────────────────────────────────────────────────────

function AllowlistTab(): ReactNode {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");

  const query = useQuery({
    queryKey: ["admin", "rate-limits", "allowlist"],
    queryFn: () => fetchJson<{ items: AllowlistEntry[] }>("/hub/admin/rate-limits/allowlist.json"),
  });

  const allowlistItems = query.data?.items ?? [];
  const {
    sortedRows: sortedAllowlist,
    sortKey,
    sortDirection,
    toggleSort,
  } = useTableSort(allowlistItems);

  const add = useMutation({
    mutationFn: async () => {
      const res = await adminFetch("/hub/admin/rate-limits/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Add failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("User added to allowlist.");
      setUserId("");
      setReason("");
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "allowlist"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (uid: string) => {
      const res = await adminFetch(`/hub/admin/rate-limits/allowlist/${encodeURIComponent(uid)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Remove failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("User removed from allowlist.");
      qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "allowlist"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add user to allowlist</DialogTitle>
            </DialogHeader>
            <form
              className="flex flex-col gap-4 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (userId.trim() && reason.trim()) add.mutate();
              }}
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor="allowlist-userid">User-UUID</Label>
                <Input
                  id="allowlist-userid"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="uuid"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="allowlist-reason">Reason</Label>
                <Input
                  id="allowlist-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. internal API test user"
                />
              </div>
              <Button type="submit" disabled={add.isPending || !userId.trim() || !reason.trim()}>
                {add.isPending ? "Adding…" : "Add"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {query.isPending ? (
        <PageLoading>Loading allowlist…</PageLoading>
      ) : query.isError ? (
        <PageError showAuthHint={needsAdminAuthHint(query.error)}>
          Error loading /hub/admin/rate-limits/allowlist.json
        </PageError>
      ) : (query.data?.items ?? []).length === 0 ? (
        <PageEmpty>No allowlist entries.</PageEmpty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Allowlist ({(query.data?.items ?? []).length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead
                    label="User-UUID"
                    sortKey="userId"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    label="Reason"
                    sortKey="reason"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <SortableTableHead
                    label="Added"
                    sortKey="createdAt"
                    activeSortKey={sortKey}
                    sortDirection={sortDirection}
                    onSort={toggleSort}
                  />
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAllowlist.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">{entry.userId}</TableCell>
                    <TableCell className="text-sm">{entry.reason}</TableCell>
                    <TableCell className="text-xs text-fg-muted">
                      {new Date(entry.createdAt).toLocaleString("en-US")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(`Remove user "${entry.userId}" from allowlist?`)
                          )
                            return;
                          remove.mutate(entry.userId);
                        }}
                      >
                        Remove
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
  );
}
