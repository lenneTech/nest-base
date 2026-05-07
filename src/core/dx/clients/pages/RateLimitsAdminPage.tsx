/**
 * `/admin/rate-limits` — Live rate-limit management for operators (issue #94).
 *
 * Four tabs:
 *   - Inspektor: live throttle rows with auto-refresh, endpoint filter,
 *                "nur gesperrt" toggle, and per-key Entsperren action.
 *   - Konfiguration: per-scope maxRequests + windowSeconds inputs with
 *                    Speichern / Zurücksetzen buttons.
 *   - Entscheidungen: sampled decision history table with pagination and
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
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

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
      subtitle="Live throttle state, Konfiguration und Allowlist"
      currentNav="rate-limits"
    >
      <Tabs defaultValue="inspector">
        <TabsList className="mb-4">
          <TabsTrigger value="inspector">Inspektor</TabsTrigger>
          <TabsTrigger value="config">Konfiguration</TabsTrigger>
          <TabsTrigger value="decisions">Entscheidungen</TabsTrigger>
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
        `/admin/rate-limits/inspector.json${scopeFilter ? `?scope=${encodeURIComponent(scopeFilter)}` : ""}`,
      ),
    refetchInterval: 5_000,
  });

  const resetKey = useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch(`/admin/rate-limits/keys/${encodeURIComponent(key)}/reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`reset failed (${res.status})`);
      return res.json();
    },
    onSuccess: (_d, key) => {
      toast.success(`Key "${key}" entsperrt.`);
      setConfirmKey(null);
      qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "inspector"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = query.data?.rows ?? [];
  const visible = blockedOnly ? rows : rows;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="inspector-scope">Endpoint enthält</Label>
              <Input
                id="inspector-scope"
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value)}
                placeholder="z.B. auth:signIn"
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
              Nur gesperrt
            </label>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "inspector"] })
              }
            >
              Aktualisieren
            </Button>
          </div>
        </CardContent>
      </Card>

      {query.isPending ? (
        <PageLoading>Lade Throttle-Einträge…</PageLoading>
      ) : query.isError ? (
        <PageError>Fehler beim Laden von /admin/rate-limits/inspector.json</PageError>
      ) : visible.length === 0 ? (
        <PageEmpty>Keine aktiven Throttle-Einträge gefunden.</PageEmpty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>
              Aktive Einträge ({visible.length} / {query.data?.total ?? 0} gesamt)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bucket-Key</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead className="text-right">Läuft ab</TableHead>
                  <TableHead className="text-right">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-mono text-xs break-all">{row.key}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right text-xs text-fg-muted">
                      {row.expiresInSeconds}s
                    </TableCell>
                    <TableCell className="text-right">
                      {confirmKey === row.key ? (
                        <div className="flex items-center justify-end gap-2">
                          <span className="text-xs text-warn">Wirklich?</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={resetKey.isPending}
                            onClick={() => resetKey.mutate(row.key)}
                          >
                            Ja
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirmKey(null)}>
                            Nein
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirmKey(row.key)}
                        >
                          Entsperren
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
    queryFn: () => fetchJson<{ scopes: ConfigScope[] }>("/admin/rate-limits/config.json"),
  });

  const globalScopes = (query.data?.scopes ?? []).filter((s) => s.scope.startsWith("global:"));
  const authScopes = (query.data?.scopes ?? []).filter((s) => s.scope.startsWith("auth:"));

  return (
    <div className="space-y-4">
      {query.isPending ? (
        <PageLoading>Lade Konfiguration…</PageLoading>
      ) : query.isError ? (
        <PageError>Fehler beim Laden von /admin/rate-limits/config.json</PageError>
      ) : (
        <>
          <ConfigSection
            title="Globale Fenster"
            scopes={globalScopes}
            onChanged={() => qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "config"] })}
          />
          <ConfigSection
            title="Auth-Endpunkte"
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Scope</TableHead>
              <TableHead>Max. Anfragen</TableHead>
              <TableHead>Fenster (s)</TableHead>
              <TableHead className="text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scopes.map((scope) => (
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
      const res = await fetch(`/admin/rate-limits/config/${encodeURIComponent(scope.scope)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxRequests: Number(maxRequests),
          windowSeconds: Number(windowSeconds),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Speichern fehlgeschlagen (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Scope "${scope.scope}" gespeichert.`);
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reset = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/admin/rate-limits/config/${encodeURIComponent(scope.scope)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Zurücksetzen fehlgeschlagen (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success(`Scope "${scope.scope}" zurückgesetzt.`);
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
            {save.isPending ? "Speichern…" : "Speichern"}
          </Button>
          {scope.isCustom && (
            <Button
              size="sm"
              variant="secondary"
              disabled={reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? "…" : "Zurücksetzen"}
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
      }>(`/admin/rate-limits/decisions.json?${params.toString()}`),
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
                placeholder="z.B. auth:signIn"
                className="w-48"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="decisions-type">Typ</Label>
              <select
                id="decisions-type"
                value={decisionFilter}
                onChange={(e) => {
                  setDecisionFilter(e.target.value);
                  setCursor(undefined);
                }}
                className="h-9 rounded-md border border-line bg-surface px-3 text-sm"
              >
                <option value="">Alle</option>
                <option value="block">Block</option>
                <option value="allow">Allow</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {query.isPending ? (
        <PageLoading>Lade Entscheidungen…</PageLoading>
      ) : query.isError ? (
        <PageError>Fehler beim Laden von /admin/rate-limits/decisions.json</PageError>
      ) : (query.data?.items ?? []).length === 0 ? (
        <PageEmpty>Keine Entscheidungen gefunden.</PageEmpty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Entscheidungen ({query.data?.total ?? 0} gesamt)</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zeitpunkt</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead className="text-right">Count / Limit</TableHead>
                  <TableHead>IP / User</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(query.data?.items ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-fg-muted whitespace-nowrap">
                      {new Date(r.ts).toLocaleString("de-DE")}
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
                  Mehr laden
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
    queryFn: () => fetchJson<{ items: AllowlistEntry[] }>("/admin/rate-limits/allowlist.json"),
  });

  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch("/admin/rate-limits/allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: userId.trim(), reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `Hinzufügen fehlgeschlagen (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Benutzer zur Allowlist hinzugefügt.");
      setUserId("");
      setReason("");
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "allowlist"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: async (uid: string) => {
      const res = await fetch(`/admin/rate-limits/allowlist/${encodeURIComponent(uid)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Entfernen fehlgeschlagen (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Benutzer aus Allowlist entfernt.");
      qc.invalidateQueries({ queryKey: ["admin", "rate-limits", "allowlist"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>Hinzufügen</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Benutzer zur Allowlist hinzufügen</DialogTitle>
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
                <Label htmlFor="allowlist-reason">Grund</Label>
                <Input
                  id="allowlist-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="z.B. interner API-Test-User"
                />
              </div>
              <Button type="submit" disabled={add.isPending || !userId.trim() || !reason.trim()}>
                {add.isPending ? "Hinzufügen…" : "Hinzufügen"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {query.isPending ? (
        <PageLoading>Lade Allowlist…</PageLoading>
      ) : query.isError ? (
        <PageError>Fehler beim Laden von /admin/rate-limits/allowlist.json</PageError>
      ) : (query.data?.items ?? []).length === 0 ? (
        <PageEmpty>Keine Einträge in der Allowlist.</PageEmpty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Allowlist ({(query.data?.items ?? []).length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User-UUID</TableHead>
                  <TableHead>Grund</TableHead>
                  <TableHead>Hinzugefügt</TableHead>
                  <TableHead className="text-right">Aktion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(query.data?.items ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">{entry.userId}</TableCell>
                    <TableCell className="text-sm">{entry.reason}</TableCell>
                    <TableCell className="text-xs text-fg-muted">
                      {new Date(entry.createdAt).toLocaleString("de-DE")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (
                            typeof window !== "undefined" &&
                            !window.confirm(`Benutzer "${entry.userId}" von Allowlist entfernen?`)
                          )
                            return;
                          remove.mutate(entry.userId);
                        }}
                      >
                        Entfernen
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
