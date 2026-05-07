/**
 * `/hub/email-outbox` — Email Outbox admin dashboard (issue #91).
 *
 * Operator surface for inspecting and acting on email-outbox rows.
 * Connects to the admin endpoints:
 *   GET  /admin/email-outbox/list.json
 *   GET  /admin/email-outbox/:id.json
 *   POST /admin/email-outbox/:id/retry
 *   POST /admin/email-outbox/:id/cancel
 *   POST /admin/email-outbox/test-send
 *
 * Features:
 *  - List view with status badges, recipient, template, attempts, next-attempt.
 *  - 30s auto-refresh via refetchInterval.
 *  - Filter UI: status, recipient substring, sortBy.
 *  - Detail panel with 4 tabs: Overview, Vars (JSON), Preview (iframe), Attempts.
 *  - Retry / Cancel action buttons (disabled when state forbids).
 *  - Test-send modal.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { Textarea } from "../components/ui/textarea.js";
import { PageEmpty, PageError, PageLoading } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson } from "../lib/api.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OutboxRecordDto {
  id: string;
  kind: string;
  status: string;
  recipient: string | null;
  template: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  claimedAt: string | null;
  lastError: string | null;
  succeededAt: string | null;
  failedAt: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: OutboxRecordDto[];
  nextCursor?: string;
  total: number;
}

interface DetailResponse {
  record: OutboxRecordDto;
  payload: unknown;
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<string, string> = {
  pending: "bg-warn/15 text-warn",
  sent: "bg-ok/15 text-ok",
  "dead-letter": "bg-err/15 text-err",
  cancelled: "bg-fg-muted/15 text-fg-muted",
};

function StatusBadge({ status }: { status: string }): ReactNode {
  const tone = STATUS_TONE[status] ?? "bg-fg-muted/15 text-fg-muted";
  return <Badge className={tone}>{status}</Badge>;
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }): ReactNode {
  const qc = useQueryClient();

  const detail = useQuery({
    queryKey: ["admin", "email-outbox", "detail", id],
    queryFn: () =>
      fetchJson<DetailResponse>(`/admin/email-outbox/${encodeURIComponent(id)}.json`),
    staleTime: 0,
  });

  const retry = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/admin/email-outbox/${encodeURIComponent(id)}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `retry failed (${res.status})`);
      }
    },
    onSuccess: () => {
      toast.success("Record queued for retry.");
      qc.invalidateQueries({ queryKey: ["admin", "email-outbox"] });
      void detail.refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const cancel = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/admin/email-outbox/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? `cancel failed (${res.status})`);
      }
    },
    onSuccess: () => {
      toast.success("Record cancelled.");
      qc.invalidateQueries({ queryKey: ["admin", "email-outbox"] });
      void detail.refetch();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (detail.isPending) return <PageLoading>Loading record…</PageLoading>;
  if (detail.isError) return <PageError>Failed to load record detail.</PageError>;

  const { record, payload } = detail.data;

  const canRetry = record.status === "pending" || record.status === "dead-letter";
  const canCancel = record.status === "pending" || record.status === "dead-letter";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!canRetry || retry.isPending}
            onClick={() => retry.mutate()}
          >
            {retry.isPending ? "Retrying…" : "Retry"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canCancel || cancel.isPending}
            onClick={() => cancel.mutate()}
            className="text-err border-err/30 hover:bg-err/10"
          >
            {cancel.isPending ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          ← Back to list
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="vars">Vars</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="attempts">Attempts</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardContent className="pt-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <dt className="text-fg-muted font-medium">ID</dt>
                <dd className="font-mono text-xs break-all">{record.id}</dd>
                <dt className="text-fg-muted font-medium">Status</dt>
                <dd>
                  <StatusBadge status={record.status} />
                </dd>
                <dt className="text-fg-muted font-medium">Kind</dt>
                <dd>{record.kind}</dd>
                <dt className="text-fg-muted font-medium">Recipient</dt>
                <dd className="break-all">{record.recipient ?? "—"}</dd>
                <dt className="text-fg-muted font-medium">Template</dt>
                <dd>{record.template ?? "—"}</dd>
                <dt className="text-fg-muted font-medium">Attempts</dt>
                <dd>{record.attemptCount}</dd>
                <dt className="text-fg-muted font-medium">Claimed at</dt>
                <dd className="text-xs">{record.claimedAt ?? "—"}</dd>
                <dt className="text-fg-muted font-medium">Next attempt at</dt>
                <dd className="text-xs">{record.nextAttemptAt ?? "—"}</dd>
                <dt className="text-fg-muted font-medium">Last error</dt>
                <dd className="text-xs text-err break-all">{record.lastError ?? "—"}</dd>
                <dt className="text-fg-muted font-medium">Succeeded at</dt>
                <dd className="text-xs">{record.succeededAt ?? "—"}</dd>
                <dt className="text-fg-muted font-medium">Failed at</dt>
                <dd className="text-xs">{record.failedAt ?? "—"}</dd>
                <dt className="text-fg-muted font-medium">Created at</dt>
                <dd className="text-xs">{record.createdAt}</dd>
                <dt className="text-fg-muted font-medium">Updated at</dt>
                <dd className="text-xs">{record.updatedAt}</dd>
                <dt className="text-fg-muted font-medium">Idempotency key</dt>
                <dd className="font-mono text-xs break-all">{record.idempotencyKey ?? "—"}</dd>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="vars" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Payload (raw vars / template options)</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="text-xs bg-surface-2 rounded p-4 overflow-auto max-h-[60dvh]">
                {JSON.stringify(payload, null, 2)}
              </pre>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="preview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Email preview</CardTitle>
            </CardHeader>
            <CardContent>
              {record.template ? (
                <iframe
                  // sandbox="" prevents the rendered email from executing
                  // scripts or navigating — the preview is read-only.
                  sandbox=""
                  src={`/hub/email-preview/${encodeURIComponent(record.template)}.html`}
                  className="w-full h-[60dvh] border border-border rounded"
                  title={`Preview: ${record.template}`}
                />
              ) : (
                <PageEmpty>No template — raw send (HTML/text from payload).</PageEmpty>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="attempts" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Attempts timeline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-fg-muted">Total attempts</span>
                <strong>{record.attemptCount}</strong>
              </div>
              {record.lastError && (
                <div className="flex justify-between items-start gap-4">
                  <span className="text-fg-muted shrink-0">Last error</span>
                  <span className="text-xs text-err text-right break-all">{record.lastError}</span>
                </div>
              )}
              {record.failedAt && (
                <div className="flex justify-between">
                  <span className="text-fg-muted">Dead-lettered at</span>
                  <span className="text-xs">{record.failedAt}</span>
                </div>
              )}
              {record.succeededAt && (
                <div className="flex justify-between">
                  <span className="text-fg-muted">Succeeded at</span>
                  <span className="text-xs">{record.succeededAt}</span>
                </div>
              )}
              {record.nextAttemptAt && (
                <div className="flex justify-between">
                  <span className="text-fg-muted">Next attempt at</span>
                  <span className="text-xs">{record.nextAttemptAt}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Test-send modal
// ---------------------------------------------------------------------------

function TestSendModal(): ReactNode {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState("");
  const [locale, setLocale] = useState("en");
  const [recipient, setRecipient] = useState("");
  const [vars, setVars] = useState("{}");
  const [varsError, setVarsError] = useState<string | null>(null);

  const qc = useQueryClient();

  const send = useMutation({
    mutationFn: async () => {
      let parsedVars: object = {};
      try {
        parsedVars = JSON.parse(vars) as object;
      } catch {
        throw new Error("vars must be valid JSON");
      }
      const res = await fetch("/admin/email-outbox/test-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ template, locale, recipient, vars: parsedVars }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message ?? `test-send failed (${res.status})`,
        );
      }
      return res.json() as Promise<{ id: string }>;
    },
    onSuccess: (data) => {
      toast.success(`Test email enqueued: ${data.id}`);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["admin", "email-outbox"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function handleVarsChange(raw: string): void {
    setVars(raw);
    try {
      JSON.parse(raw);
      setVarsError(null);
    } catch {
      setVarsError("Invalid JSON");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Test-send
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send test email via outbox</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label htmlFor="ts-template">Template</Label>
            <Input
              id="ts-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              placeholder="e.g. welcome"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ts-locale">Locale</Label>
            <Input
              id="ts-locale"
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              placeholder="en"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ts-recipient">Recipient</Label>
            <Input
              id="ts-recipient"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder="user@example.com"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ts-vars">Vars (JSON)</Label>
            <Textarea
              id="ts-vars"
              value={vars}
              onChange={(e) => handleVarsChange(e.target.value)}
              className="font-mono text-xs min-h-[80px]"
            />
            {varsError && <p className="text-xs text-err">{varsError}</p>}
          </div>
          <Button
            className="w-full"
            disabled={send.isPending || !template.trim() || !recipient.trim() || !!varsError}
            onClick={() => send.mutate()}
          >
            {send.isPending ? "Sending…" : "Send via outbox"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function EmailOutboxPage(): ReactNode {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [recipientFilter, setRecipientFilter] = useState("");
  const [sortBy, setSortBy] = useState<string>("");

  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (recipientFilter.trim()) params.set("recipient", recipientFilter.trim());
  if (sortBy) params.set("sortBy", sortBy);

  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["admin", "email-outbox", "list", statusFilter, recipientFilter, sortBy],
    queryFn: () =>
      fetchJson<ListResponse>(`/admin/email-outbox/list.json?${params.toString()}`),
    // 30s auto-refresh so operators see new rows without manual reload
    refetchInterval: 30_000,
  });

  function handleRefresh(): void {
    qc.invalidateQueries({ queryKey: ["admin", "email-outbox"] });
  }

  if (selectedId) {
    return (
      <AdminShell title="Email Outbox" subtitle="Record detail" currentNav="email-outbox">
        <DetailPanel id={selectedId} onClose={() => setSelectedId(null)} />
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Email Outbox"
      subtitle="Operator view — inspect and act on outbox rows"
      currentNav="email-outbox"
    >
      <div className="space-y-4">
        {/* Filter bar */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1 min-w-[140px]">
                <Label>Status</Label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="dead-letter">Dead-letter</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex-1 min-w-[160px]">
                <Label>Recipient</Label>
                <Input
                  className="h-8 text-xs"
                  value={recipientFilter}
                  onChange={(e) => setRecipientFilter(e.target.value)}
                  placeholder="Substring filter…"
                />
              </div>
              <div className="space-y-1 min-w-[130px]">
                <Label>Sort by</Label>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v === "default" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Time (newest)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Time (newest)</SelectItem>
                    <SelectItem value="attempts">Attempts (most)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleRefresh}>
                  Refresh
                </Button>
                <TestSendModal />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* List */}
        {list.isPending ? (
          <PageLoading>Loading email-outbox rows…</PageLoading>
        ) : list.isError ? (
          <PageError>Failed to load outbox list. Check your permissions.</PageError>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                Rows ({list.data?.total ?? 0}){" "}
                <span className="text-xs text-fg-muted font-normal">
                  — showing {list.data?.items?.length ?? 0}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(list.data?.items ?? []).length === 0 ? (
                <PageEmpty>No rows match the current filter.</PageEmpty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead className="text-right">Attempts</TableHead>
                      <TableHead>Next attempt at</TableHead>
                      <TableHead>Created at</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(list.data?.items ?? []).map((row) => (
                      <TableRow
                        key={row.id}
                        className="cursor-pointer hover:bg-surface-2/60"
                        onClick={() => setSelectedId(row.id)}
                      >
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-xs max-w-[180px] truncate">
                          {row.recipient ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs">{row.template ?? "—"}</TableCell>
                        <TableCell className="text-right">{row.attemptCount}</TableCell>
                        <TableCell className="text-xs text-fg-muted">
                          {row.nextAttemptAt ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs text-fg-muted">{row.createdAt}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {list.data?.nextCursor && (
                <p className="text-xs text-fg-muted mt-3">
                  More rows available — adjust filters or limit to see them.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
