/**
 * `/dev/migrations` — five-tab Prisma migration dashboard
 * (Status / Pending / Diff / History / Create New). Server data comes
 * from `/dev/migrations.json`; mutations POST to lock-gated
 * `/dev/migrations/*` endpoints.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";
import { cn } from "../lib/utils.js";

interface AppliedRow {
  id: string;
  migration_name: string;
  started_at: string;
  finished_at: string | null;
  applied_steps_count: number;
  logs: string | null;
  rolled_back_at: string | null;
}

interface PendingRow {
  name: string;
}

interface FailedRow extends AppliedRow {
  failed: true;
}

interface MigrationsStatus {
  applied: AppliedRow[];
  pending: PendingRow[];
  failed: FailedRow[];
  driftDetected: boolean;
  driftReasons: string[];
  migrationsRoot: string;
  generatedAt: string;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (parsed && typeof parsed === "object" && "message" in parsed
        ? (parsed as { message?: string }).message
        : null) ?? `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return parsed as T;
}

export function MigrationsPage(): ReactNode {
  const status = useQuery({
    queryKey: ["dev", "migrations", "status"],
    queryFn: () => fetchJson<MigrationsStatus>("/dev/migrations.json"),
    refetchInterval: 30_000,
  });

  const subtitle = status.data
    ? `${status.data.applied.length} applied · ${status.data.pending.length} pending · ${status.data.failed.length} failed`
    : "Loading migration status…";

  return (
    <AdminShell title="Migrations" subtitle={subtitle} currentNav="migrations">
      {status.data ? (
        <MigrationsBody data={status.data} />
      ) : status.isError ? (
        <PageError>Failed to load migration status.</PageError>
      ) : (
        <PageLoading>Loading migrations…</PageLoading>
      )}
    </AdminShell>
  );
}

function MigrationsBody({ data }: { data: MigrationsStatus }): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <MigrationsTimeline data={data} />
      {data.driftDetected ? <DriftBanner reasons={data.driftReasons} /> : null}
      <Tabs defaultValue="status">
        <TabsList>
          <TabsTrigger value="status">Status</TabsTrigger>
          <TabsTrigger value="pending">Pending ({data.pending.length})</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="create">Create New</TabsTrigger>
        </TabsList>
        <TabsContent value="status">
          <StatusTab data={data} />
        </TabsContent>
        <TabsContent value="pending">
          <PendingTab data={data} />
        </TabsContent>
        <TabsContent value="diff">
          <DiffTab />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab data={data} />
        </TabsContent>
        <TabsContent value="create">
          <CreateNewTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MigrationsTimeline({ data }: { data: MigrationsStatus }): ReactNode {
  const all = [
    ...data.applied.map((m) => ({ name: m.migration_name, kind: "applied" as const })),
    ...data.failed.map((m) => ({ name: m.migration_name, kind: "failed" as const })),
    ...data.pending.map((m) => ({ name: m.name, kind: "pending" as const })),
  ];
  const palette: Record<
    (typeof all)[number]["kind"],
    { tone: "ok" | "err" | "warn"; dot: string }
  > = {
    applied: { tone: "ok", dot: "bg-ok" },
    failed: { tone: "err", dot: "bg-err" },
    pending: { tone: "warn", dot: "bg-warn" },
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2" data-testid="mig-timeline">
          {all.length === 0 ? (
            <span className="text-sm text-fg-muted">No migrations.</span>
          ) : (
            all.map((m) => {
              const meta = palette[m.kind];
              return (
                <Badge key={m.name} variant={meta.tone} className="font-mono text-[0.65rem]">
                  <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                  {m.name}
                </Badge>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DriftBanner({ reasons }: { reasons: string[] }): ReactNode {
  return (
    <Card className="border-warn/40 bg-warn/10" role="status">
      <CardHeader>
        <CardTitle className="text-warn">Drift detected</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="ml-4 list-disc text-sm">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-fg-muted">
          Database schema diverges from migration history. Inspect the <strong>Diff</strong> tab and
          decide whether to write a corrective migration or reset the dev DB.
        </p>
      </CardContent>
    </Card>
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  primaryLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
  children?: ReactNode;
}

function ConfirmDialog({
  isOpen,
  onClose,
  title,
  primaryLabel,
  onConfirm,
  isPending,
  children,
}: ConfirmDialogProps): ReactNode {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-fg-muted">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? "Working…" : primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewDialog({
  preview,
  onClose,
}: {
  preview: { name: string; sql: string } | null;
  onClose: () => void;
}): ReactNode {
  return (
    <Dialog open={preview !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{preview?.name ?? ""} — SQL</DialogTitle>
        </DialogHeader>
        <pre className="m-0 max-h-[60vh] overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs">
          {preview?.sql ?? ""}
        </pre>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusTab({ data }: { data: MigrationsStatus }): ReactNode {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<{ name: string; logs: string | null } | null>(null);
  const retry = useMutation({
    mutationFn: (name: string) =>
      postJson<{ success: boolean; stderr: string }>("/dev/migrations/retry", { name }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["dev", "migrations", "status"] }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Applied + failed migrations</CardTitle>
      </CardHeader>
      <CardContent>
        {data.applied.length === 0 && data.failed.length === 0 ? (
          <PageEmpty>No applied migrations yet.</PageEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Finished</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data.failed, ...data.applied].map((row) => (
                <TableRow key={row.id} data-state={row.finished_at ? "applied" : "failed"}>
                  <TableCell>
                    <code className="font-mono text-xs">{row.migration_name}</code>
                  </TableCell>
                  <TableCell className="font-mono text-[0.7rem]">
                    {formatDate(row.started_at)}
                  </TableCell>
                  <TableCell className="font-mono text-[0.7rem]">
                    {row.finished_at ? formatDate(row.finished_at) : "—"}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums">
                    {row.applied_steps_count}
                  </TableCell>
                  <TableCell>
                    {row.finished_at ? (
                      <Badge variant="ok">applied</Badge>
                    ) : (
                      <Badge variant="err">failed</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!row.finished_at ? (
                      <Button
                        size="sm"
                        onClick={() =>
                          setConfirm({ name: row.migration_name, logs: row.logs ?? null })
                        }
                      >
                        Retry…
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <ConfirmDialog
          isOpen={confirm !== null}
          onClose={() => setConfirm(null)}
          title={confirm ? `Retry ${confirm.name}?` : ""}
          primaryLabel="Retry migration"
          isPending={retry.isPending}
          onConfirm={() => {
            if (!confirm) return;
            retry.mutate(confirm.name, { onSettled: () => setConfirm(null) });
          }}
        >
          <p>
            This will mark the migration as <em>rolled back</em> and re-apply it.
          </p>
          {confirm?.logs ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface-3 p-2 font-mono text-[0.7rem]">
              {confirm.logs}
            </pre>
          ) : null}
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}

function PendingTab({ data }: { data: MigrationsStatus }): ReactNode {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ name: string; sql: string } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "one" | "all" | "dry"; name?: string } | null>(
    null,
  );

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["dev", "migrations", "status"] });

  const deployAll = useMutation({
    mutationFn: () => postJson<{ success: boolean; stderr: string }>("/dev/migrations/deploy"),
    onSettled: refresh,
  });
  const applyOne = useMutation({
    mutationFn: (name: string) =>
      postJson<{ success: boolean; stderr: string }>("/dev/migrations/apply-one", { name }),
    onSettled: refresh,
  });
  const dryRun = useMutation({
    mutationFn: (name: string) =>
      postJson<{ success: boolean; error?: string }>("/dev/migrations/dry-run", { name }),
  });

  const loadPreview = async (name: string) => {
    const result = await fetchJson<{ name: string; sql: string }>(
      `/dev/migrations/preview/${encodeURIComponent(name)}`,
    );
    setPreview(result);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Pending migrations ({data.pending.length})</CardTitle>
        <Button disabled={data.pending.length === 0} onClick={() => setConfirm({ kind: "all" })}>
          Apply All Pending
        </Button>
      </CardHeader>
      <CardContent>
        {data.pending.length === 0 ? (
          <PageEmpty>Schema is up to date.</PageEmpty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.pending.map((row) => (
                <TableRow key={row.name}>
                  <TableCell>
                    <code className="font-mono text-xs">{row.name}</code>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void loadPreview(row.name)}
                      >
                        Preview SQL
                      </Button>
                      <Button size="sm" onClick={() => setConfirm({ kind: "one", name: row.name })}>
                        Apply this one…
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirm({ kind: "dry", name: row.name })}
                      >
                        Dry-Run
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <PreviewDialog preview={preview} onClose={() => setPreview(null)} />

        <ConfirmDialog
          isOpen={confirm !== null}
          onClose={() => setConfirm(null)}
          title={
            confirm?.kind === "all"
              ? `Apply ${data.pending.length} pending migration(s)?`
              : confirm?.kind === "one"
                ? `Apply ${confirm.name}?`
                : confirm?.kind === "dry"
                  ? `Dry-Run ${confirm.name}?`
                  : ""
          }
          primaryLabel={confirm?.kind === "dry" ? "Dry-Run" : "Apply migration(s)"}
          isPending={deployAll.isPending || applyOne.isPending || dryRun.isPending}
          onConfirm={() => {
            if (!confirm) return;
            if (confirm.kind === "all") {
              deployAll.mutate(undefined, { onSettled: () => setConfirm(null) });
            } else if (confirm.kind === "one" && confirm.name) {
              applyOne.mutate(confirm.name, { onSettled: () => setConfirm(null) });
            } else if (confirm.kind === "dry" && confirm.name) {
              dryRun.mutate(confirm.name, { onSettled: () => setConfirm(null) });
            }
          }}
        >
          {confirm?.kind === "all" ? (
            <ul className="ml-4 list-disc">
              {data.pending.map((p) => (
                <li key={p.name}>
                  <code className="font-mono text-xs">{p.name}</code>
                </li>
              ))}
            </ul>
          ) : confirm?.kind === "dry" ? (
            <p>
              Runs the migration in a transaction and rolls back at the end. Non-destructive — does
              not change the database.
            </p>
          ) : (
            <p>
              This will execute the SQL via{" "}
              <code className="font-mono text-accent">prisma migrate deploy</code>. Make sure you
              reviewed the SQL preview first.
            </p>
          )}
        </ConfirmDialog>
      </CardContent>
    </Card>
  );
}

function DiffTab(): ReactNode {
  const diff = useQuery({
    queryKey: ["dev", "migrations", "diff"],
    queryFn: () =>
      fetchJson<{ sql: string; success: boolean; stderr: string }>("/dev/migrations/diff"),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Schema diff</CardTitle>
      </CardHeader>
      <CardContent>
        {diff.isLoading ? (
          <PageLoading>Computing diff…</PageLoading>
        ) : diff.isError ? (
          <PageError>Diff failed: {String(diff.error)}</PageError>
        ) : !diff.data?.success ? (
          <pre className="m-0 max-h-[60vh] overflow-auto rounded-md border border-err/40 bg-err/10 p-3 font-mono text-xs text-err">
            {diff.data?.stderr ?? "Diff unavailable."}
          </pre>
        ) : !diff.data.sql.trim() ? (
          <PageEmpty>No schema diff — DB matches schema.prisma.</PageEmpty>
        ) : (
          <pre className="m-0 max-h-[60vh] overflow-auto rounded-md border border-line bg-surface-2 p-3 font-mono text-xs">
            {diff.data.sql}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryTab({ data }: { data: MigrationsStatus }): ReactNode {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Migration history</CardTitle>
      </CardHeader>
      <CardContent>
        {data.applied.length === 0 ? (
          <PageEmpty>No applied migrations yet.</PageEmpty>
        ) : (
          <ol className="flex flex-col gap-2">
            {data.applied.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between rounded-md border border-line bg-surface-2 px-3 py-2"
              >
                <code className="font-mono text-xs">{row.migration_name}</code>
                <span className="text-[0.7rem] text-fg-muted">
                  {formatDate(row.started_at)} · {row.applied_steps_count} step(s)
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function CreateNewTab(): ReactNode {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<{ folder?: string; sql?: string; name: string } | null>(
    null,
  );
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["dev", "migrations", "status"] });

  const create = useMutation({
    mutationFn: (n: string) =>
      postJson<{ success: boolean; folder?: string; sql?: string; stderr: string; name: string }>(
        "/dev/migrations/create",
        { name: n },
      ),
    onSuccess: (res) => {
      setCreated(res);
      refresh();
    },
  });

  const apply = useMutation({
    mutationFn: (folder: string) =>
      postJson<{ success: boolean }>("/dev/migrations/apply-draft", { name: folder }),
    onSettled: () => {
      setCreated(null);
      setName("");
      refresh();
    },
  });

  const discard = useMutation({
    mutationFn: (folder: string) =>
      fetch(`/dev/migrations/draft/${encodeURIComponent(folder)}`, { method: "DELETE" }).then(
        (r) => {
          if (!r.ok) throw new Error(`discard failed: ${r.status}`);
          return r.json();
        },
      ),
    onSettled: () => {
      setCreated(null);
      setName("");
      refresh();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create new migration</CardTitle>
        <p className="text-xs text-fg-muted">
          Generates a draft via{" "}
          <code className="font-mono text-accent">prisma migrate dev --create-only</code>. The
          migration is <strong>not applied</strong> until you click Apply.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-1 min-w-64 flex-col gap-1.5">
            <Label htmlFor="mig-name">Migration name</Label>
            <Input
              id="mig-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="add-user-table"
              required
            />
          </div>
          <Button disabled={!name || create.isPending} onClick={() => create.mutate(name)}>
            {create.isPending ? "Generating…" : "Generate"}
          </Button>
        </div>
        {create.isError ? (
          <pre className="m-0 max-h-32 overflow-auto rounded-md border border-err/40 bg-err/10 p-3 font-mono text-xs text-err">
            {String(create.error)}
          </pre>
        ) : null}

        {created ? (
          <div className="rounded-md border border-line bg-surface-2 p-3">
            <h4 className="mb-2 text-sm font-semibold">
              Draft: <code className="font-mono">{created.folder ?? created.name}</code>
            </h4>
            {created.sql ? (
              <pre className="m-0 max-h-64 overflow-auto rounded bg-surface-3 p-2 font-mono text-xs">
                {created.sql}
              </pre>
            ) : (
              <PageEmpty>No SQL preview available.</PageEmpty>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={!created.folder || apply.isPending}
                onClick={() => created.folder && apply.mutate(created.folder)}
              >
                {apply.isPending ? "Applying…" : "Apply"}
              </Button>
              <Button
                variant="outline"
                disabled={!created.folder || discard.isPending}
                onClick={() => created.folder && discard.mutate(created.folder)}
              >
                Discard
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}
