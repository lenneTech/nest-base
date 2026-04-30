/**
 * `/dev/migrations` — Issue #10 dev-portal page.
 *
 * Five tabs (Status, Pending, Diff, History, Create New) over the same
 * `<AdminShell>` chrome every other dev-portal page uses. Server data
 * comes from `/dev/migrations.json`; mutations POST to the lock-gated
 * `/dev/migrations/*` endpoints.
 *
 * No native `<button>` / `<input>` elements — every interactive
 * primitive comes from `clients/components/` (Button, TextField, Tabs)
 * or directly from `react-aria-components` (Dialog/Modal). The full
 * ERD-diff visualisation tracked in the AC is out of scope for this
 * slice and lands as a follow-up issue.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";

import { Button, Tab, TabList, TabPanel, Tabs, TextField } from "../components/index.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

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
        <div className="admin-empty">Failed to load migration status.</div>
      ) : (
        <div className="admin-empty">Loading migrations…</div>
      )}
    </AdminShell>
  );
}

function MigrationsBody({ data }: { data: MigrationsStatus }): ReactNode {
  return (
    <>
      <MigrationsTimeline data={data} />
      {data.driftDetected ? <DriftBanner reasons={data.driftReasons} /> : null}
      <Tabs defaultSelectedKey="status">
        <TabList aria-label="Migration tabs">
          <Tab id="status">Status</Tab>
          <Tab id="pending">Pending ({data.pending.length})</Tab>
          <Tab id="diff">Diff</Tab>
          <Tab id="history">History</Tab>
          <Tab id="create">Create New</Tab>
        </TabList>
        <TabPanel id="status">
          <StatusTab data={data} />
        </TabPanel>
        <TabPanel id="pending">
          <PendingTab data={data} />
        </TabPanel>
        <TabPanel id="diff">
          <DiffTab />
        </TabPanel>
        <TabPanel id="history">
          <HistoryTab data={data} />
        </TabPanel>
        <TabPanel id="create">
          <CreateNewTab />
        </TabPanel>
      </Tabs>
    </>
  );
}

function MigrationsTimeline({ data }: { data: MigrationsStatus }): ReactNode {
  const all = [
    ...data.applied.map((m) => ({ name: m.migration_name, kind: "applied" as const })),
    ...data.failed.map((m) => ({ name: m.migration_name, kind: "failed" as const })),
    ...data.pending.map((m) => ({ name: m.name, kind: "pending" as const })),
  ];
  return (
    <div className="admin-card">
      <h3 className="feat-section__title">Timeline</h3>
      <div className="mig-timeline" data-testid="mig-timeline">
        {all.length === 0 ? (
          <span className="admin-meta">No migrations.</span>
        ) : (
          all.map((m) => (
            <span key={m.name} className={`mig-pill mig-pill--${m.kind}`} title={m.name}>
              <span className="mig-pill__dot" />
              {m.name}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function DriftBanner({ reasons }: { reasons: string[] }): ReactNode {
  return (
    <div className="admin-card mig-drift" role="status">
      <h3 className="feat-section__title">Drift detected</h3>
      <ul className="mig-drift__list">
        {reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="admin-meta">
        Database schema diverges from migration history. Inspect <strong>Diff</strong> tab and
        decide whether to write a corrective migration or reset the dev DB.
      </p>
    </div>
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

/**
 * Controlled confirmation modal — react-aria-components `Modal` driven
 * by a parent's `isOpen` prop instead of a `DialogTrigger` because the
 * trigger lives on a different row from the modal in our layout.
 */
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
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="dp-modal-overlay"
      isDismissable
    >
      <Modal className="dp-modal">
        <Dialog>
          <Heading slot="title" className="dp-modal__title">
            {title}
          </Heading>
          <div className="mig-modal-body">{children}</div>
          <div className="mig-modal-actions">
            <Button onPress={onClose}>Cancel</Button>
            <Button variant="accent" isDisabled={isPending} onPress={onConfirm}>
              {isPending ? "Working…" : primaryLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
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
    <ModalOverlay
      isOpen={preview !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="dp-modal-overlay"
      isDismissable
    >
      <Modal className="dp-modal mig-modal--wide">
        <Dialog>
          <Heading slot="title" className="dp-modal__title">
            {preview?.name ?? ""} — SQL
          </Heading>
          <pre className="mig-pre">{preview?.sql ?? ""}</pre>
          <div className="mig-modal-actions">
            <Button variant="accent" onPress={onClose}>
              Close
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
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
    <div className="admin-card">
      <h3 className="feat-section__title">Applied + failed migrations</h3>
      {data.applied.length === 0 && data.failed.length === 0 ? (
        <div className="admin-empty">No applied migrations yet.</div>
      ) : (
        <table className="mig-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Started</th>
              <th>Finished</th>
              <th>Steps</th>
              <th>State</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...data.failed, ...data.applied].map((row) => (
              <tr key={row.id} data-state={row.finished_at ? "applied" : "failed"}>
                <td>
                  <code>{row.migration_name}</code>
                </td>
                <td>{formatDate(row.started_at)}</td>
                <td>{row.finished_at ? formatDate(row.finished_at) : "—"}</td>
                <td>{row.applied_steps_count}</td>
                <td>
                  {row.finished_at ? (
                    <span className="mig-badge mig-badge--ok">applied</span>
                  ) : (
                    <span className="mig-badge mig-badge--err">failed</span>
                  )}
                </td>
                <td>
                  {!row.finished_at ? (
                    <Button
                      variant="accent"
                      onPress={() =>
                        setConfirm({ name: row.migration_name, logs: row.logs ?? null })
                      }
                    >
                      Retry…
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        {confirm?.logs ? <pre className="mig-pre">{confirm.logs}</pre> : null}
      </ConfirmDialog>
    </div>
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
    <div className="admin-card">
      <div className="mig-actions">
        <h3 className="feat-section__title">Pending migrations ({data.pending.length})</h3>
        <Button
          variant="accent"
          isDisabled={data.pending.length === 0}
          onPress={() => setConfirm({ kind: "all" })}
        >
          Apply All Pending
        </Button>
      </div>
      {data.pending.length === 0 ? (
        <div className="admin-empty">Schema is up to date.</div>
      ) : (
        <table className="mig-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.pending.map((row) => (
              <tr key={row.name}>
                <td>
                  <code>{row.name}</code>
                </td>
                <td className="mig-actions-cell">
                  <Button onPress={() => void loadPreview(row.name)}>Preview SQL</Button>
                  <Button
                    variant="accent"
                    onPress={() => setConfirm({ kind: "one", name: row.name })}
                  >
                    Apply this one…
                  </Button>
                  <Button onPress={() => setConfirm({ kind: "dry", name: row.name })}>
                    Dry-Run
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
          <ul>
            {data.pending.map((p) => (
              <li key={p.name}>
                <code>{p.name}</code>
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
            This will execute the SQL via <code>prisma migrate deploy</code>. Make sure you reviewed
            the SQL preview first.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

function DiffTab(): ReactNode {
  const diff = useQuery({
    queryKey: ["dev", "migrations", "diff"],
    queryFn: () =>
      fetchJson<{ sql: string; success: boolean; stderr: string }>("/dev/migrations/diff"),
  });
  return (
    <div className="admin-card">
      <h3 className="feat-section__title">Schema diff</h3>
      {diff.isLoading ? (
        <div className="admin-empty">Computing diff…</div>
      ) : diff.isError ? (
        <div className="admin-empty">Diff failed: {String(diff.error)}</div>
      ) : !diff.data?.success ? (
        <pre className="mig-pre mig-pre--err">{diff.data?.stderr ?? "Diff unavailable."}</pre>
      ) : !diff.data.sql.trim() ? (
        <div className="admin-empty">No schema diff — DB matches schema.prisma.</div>
      ) : (
        <pre className="mig-pre">{diff.data.sql}</pre>
      )}
    </div>
  );
}

function HistoryTab({ data }: { data: MigrationsStatus }): ReactNode {
  return (
    <div className="admin-card">
      <h3 className="feat-section__title">Migration history</h3>
      {data.applied.length === 0 ? (
        <div className="admin-empty">No applied migrations yet.</div>
      ) : (
        <ol className="mig-history">
          {data.applied.map((row) => (
            <li key={row.id}>
              <code>{row.migration_name}</code>
              <span className="admin-meta">
                {formatDate(row.started_at)} · {row.applied_steps_count} step(s)
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
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
    <div className="admin-card">
      <h3 className="feat-section__title">Create new migration</h3>
      <p className="admin-meta">
        Generates a draft via <code>prisma migrate dev --create-only</code>. The migration is{" "}
        <strong>not applied</strong> until you click Apply.
      </p>
      <div className="mig-create-form">
        <TextField
          label="Migration name"
          value={name}
          onChange={setName}
          placeholder="add-user-table"
          isRequired
        />
        <Button
          variant="accent"
          isDisabled={!name || create.isPending}
          onPress={() => create.mutate(name)}
        >
          {create.isPending ? "Generating…" : "Generate"}
        </Button>
      </div>
      {create.isError ? <pre className="mig-pre mig-pre--err">{String(create.error)}</pre> : null}

      {created ? (
        <div className="mig-draft">
          <h4>
            Draft: <code>{created.folder ?? created.name}</code>
          </h4>
          {created.sql ? (
            <pre className="mig-pre">{created.sql}</pre>
          ) : (
            <div className="admin-empty">No SQL preview available.</div>
          )}
          <div className="mig-actions-cell">
            <Button
              variant="accent"
              isDisabled={!created.folder || apply.isPending}
              onPress={() => created.folder && apply.mutate(created.folder)}
            >
              {apply.isPending ? "Applying…" : "Apply"}
            </Button>
            <Button
              isDisabled={!created.folder || discard.isPending}
              onPress={() => created.folder && discard.mutate(created.folder)}
            >
              Discard
            </Button>
          </div>
        </div>
      ) : null}
    </div>
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
