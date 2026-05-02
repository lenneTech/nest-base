/**
 * `/dev/jobs` — jobs dashboard with two tabs (Queues / Jobs) over the
 * in-memory queue (and any future pg-boss-backed adapter that exposes
 * the same `/dev/jobs/*` JSON contract).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { JsonViewer } from "../components/JsonViewer.js";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { PageEmpty, PageError, PageLoading, StatTile } from "../components/PageState.js";
import { AdminShell } from "../layout/AdminShell.js";
import { fetchJson, formatMs } from "../lib/api.js";

interface StateCounts {
  created: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  retry: number;
}

interface QueueAggregate {
  name: string;
  total: number;
  counts: StateCounts;
  p95LatencyMs: number | null;
  failureRate: number;
}

interface JobAggregates {
  totalJobs: number;
  totals: StateCounts;
  failureRate: number;
  p95LatencyMs: number | null;
  queues: QueueAggregate[];
}

type JobState = keyof StateCounts;

interface JobRecord {
  id: string;
  name: string;
  state: JobState;
  attempt: number;
  payload: unknown;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  errorStack?: string;
}

interface JobListResponse {
  jobs: JobRecord[];
}

const STATE_FILTERS: readonly { id: string; label: string }[] = [
  { id: "all", label: "All states" },
  { id: "created", label: "Created" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
  { id: "cancelled", label: "Cancelled" },
  { id: "retry", label: "Retry" },
];

const POLL_INTERVAL_MS = 4000;

export function JobsPage(): ReactNode {
  const aggregates = useQuery({
    queryKey: ["dev", "jobs", "queues"],
    queryFn: () => fetchJson<JobAggregates>("/dev/jobs/queues.json"),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const subtitle = aggregates.data
    ? `${aggregates.data.totalJobs} jobs across ${aggregates.data.queues.length} queues · auto-refresh every ${POLL_INTERVAL_MS / 1000} s`
    : "Loading…";

  return (
    <AdminShell title="Jobs" subtitle={subtitle} currentNav="jobs">
      {aggregates.data ? (
        <JobsBody aggregates={aggregates.data} />
      ) : aggregates.isError ? (
        <PageError>Failed to load job aggregates.</PageError>
      ) : (
        <PageLoading>Loading job aggregates…</PageLoading>
      )}
    </AdminShell>
  );
}

function JobsBody({ aggregates }: { aggregates: JobAggregates }): ReactNode {
  const [queueFilter, setQueueFilter] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("queues");

  return (
    <div className="flex flex-col gap-6">
      <SummaryTiles aggregates={aggregates} />
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="queues">Queues</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="queues">
          <QueuesTab
            aggregates={aggregates}
            onQueueClick={(name) => {
              setQueueFilter(name);
              setActiveTab("jobs");
            }}
          />
        </TabsContent>
        <TabsContent value="jobs">
          <JobsTab
            queueFilter={queueFilter}
            onQueueFilterChange={setQueueFilter}
            stateFilter={stateFilter}
            onStateFilterChange={setStateFilter}
            queueOptions={aggregates.queues.map((q) => q.name)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryTiles({ aggregates }: { aggregates: JobAggregates }): ReactNode {
  const failurePct = (aggregates.failureRate * 100).toFixed(1);
  const p95 = aggregates.p95LatencyMs === null ? "—" : formatMs(aggregates.p95LatencyMs);
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
      <StatTile label="Total jobs" value={aggregates.totalJobs} />
      <StatTile label="Completed" value={aggregates.totals.completed} tone="ok" />
      <StatTile
        label="Active / pending"
        value={
          aggregates.totals.active + aggregates.totals.created + aggregates.totals.retry
        }
        tone="info"
      />
      <StatTile
        label="Failed"
        value={aggregates.totals.failed}
        tone={aggregates.totals.failed > 0 ? "err" : "default"}
      />
      <StatTile label="Failure rate" value={`${failurePct}%`} />
      <StatTile label="p95 latency" value={p95} />
    </div>
  );
}

interface QueuesTabProps {
  aggregates: JobAggregates;
  onQueueClick: (name: string) => void;
}

function QueuesTab({ aggregates, onQueueClick }: QueuesTabProps): ReactNode {
  if (aggregates.queues.length === 0) {
    return <PageEmpty>No queues active yet — enqueue a job to see it here.</PageEmpty>;
  }
  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Queue</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Completed</TableHead>
              <TableHead className="text-right">Failed</TableHead>
              <TableHead className="text-right">p95 latency</TableHead>
              <TableHead className="text-right">Failure rate</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {aggregates.queues.map((queue) => (
              <TableRow key={queue.name}>
                <TableCell>
                  <strong className="font-mono text-xs">{queue.name}</strong>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{queue.total}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {queue.counts.active + queue.counts.created}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-ok">
                  {queue.counts.completed}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums text-err">
                  {queue.counts.failed}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {queue.p95LatencyMs === null ? "—" : formatMs(queue.p95LatencyMs)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {(queue.failureRate * 100).toFixed(1)}%
                </TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => onQueueClick(queue.name)}>
                    Filter jobs →
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface JobsTabProps {
  queueFilter: string;
  onQueueFilterChange: (next: string) => void;
  stateFilter: string;
  onStateFilterChange: (next: string) => void;
  queueOptions: readonly string[];
}

function JobsTab({
  queueFilter,
  onQueueFilterChange,
  stateFilter,
  onStateFilterChange,
  queueOptions,
}: JobsTabProps): ReactNode {
  const params = new URLSearchParams();
  if (queueFilter) params.set("name", queueFilter);
  if (stateFilter && stateFilter !== "all") params.set("state", stateFilter);
  params.set("limit", "100");

  const list = useQuery({
    queryKey: ["dev", "jobs", "list", queueFilter, stateFilter],
    queryFn: () => fetchJson<JobListResponse>(`/dev/jobs/jobs.json?${params.toString()}`),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queueChoices = ["all", ...queueOptions];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobs</CardTitle>
        <div className="mt-3 flex flex-wrap gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-dim">
              Queue
            </span>
            <Select
              value={queueFilter || "all"}
              onValueChange={(key) => onQueueFilterChange(key === "all" ? "" : key)}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {queueChoices.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name === "all" ? "All queues" : name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.65rem] font-semibold uppercase tracking-widest text-fg-dim">
              State
            </span>
            <Select value={stateFilter} onValueChange={onStateFilterChange}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATE_FILTERS.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {list.data ? (
          list.data.jobs.length === 0 ? (
            <PageEmpty>No jobs match the current filters.</PageEmpty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Queue</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Attempt</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.jobs.map((job) => (
                  <JobRow key={job.id} job={job} onInspect={() => setSelectedId(job.id)} />
                ))}
              </TableBody>
            </Table>
          )
        ) : list.isError ? (
          <PageError>Failed to load jobs.</PageError>
        ) : (
          <PageLoading>Loading jobs…</PageLoading>
        )}
      </CardContent>
      {selectedId ? <JobDrawer id={selectedId} onClose={() => setSelectedId(null)} /> : null}
    </Card>
  );
}

function JobRow({ job, onInspect }: { job: JobRecord; onInspect: () => void }): ReactNode {
  const created = new Date(job.createdAt).toISOString().slice(11, 19);
  const duration =
    job.startedAt !== undefined && job.completedAt !== undefined
      ? formatMs(job.completedAt - job.startedAt)
      : "—";
  return (
    <TableRow>
      <TableCell>
        <code className="font-mono text-[0.7rem] text-fg-muted">{job.id.slice(0, 8)}…</code>
      </TableCell>
      <TableCell className="font-mono text-xs">{job.name}</TableCell>
      <TableCell>
        <StateBadge state={job.state} />
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">{job.attempt}</TableCell>
      <TableCell className="font-mono text-[0.7rem] text-fg-muted">{created}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">{duration}</TableCell>
      <TableCell>
        <Button size="sm" variant="outline" onClick={onInspect}>
          Inspect
        </Button>
      </TableCell>
    </TableRow>
  );
}

function StateBadge({ state }: { state: JobState }): ReactNode {
  const tone =
    state === "failed"
      ? "err"
      : state === "cancelled"
        ? "warn"
        : state === "completed"
          ? "ok"
          : state === "active" || state === "retry"
            ? "info"
            : "secondary";
  return <Badge variant={tone}>{state}</Badge>;
}

function JobDrawer({ id, onClose }: { id: string; onClose: () => void }): ReactNode {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["dev", "jobs", "detail", id],
    queryFn: () => fetchJson<JobRecord>(`/dev/jobs/jobs/${encodeURIComponent(id)}.json`),
  });

  const retry = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/dev/jobs/jobs/${encodeURIComponent(id)}/retry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Retry failed: ${res.status} ${text}`);
      }
      return (await res.json()) as { id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dev", "jobs"] });
    },
  });

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            Job <code className="font-mono text-sm">{id.slice(0, 16)}…</code>
          </DialogTitle>
          {detail.data ? (
            <DialogDescription>
              Queue <code className="text-fg">{detail.data.name}</code> · state{" "}
              <StateBadge state={detail.data.state} /> · attempt {detail.data.attempt}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {detail.data ? (
          <div className="flex flex-col gap-4">
            {detail.data.errorMessage ? (
              <Card className="border-err/40">
                <CardHeader>
                  <CardTitle className="text-err">Error</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="m-0 whitespace-pre-wrap font-mono text-xs text-err">
                    {detail.data.errorMessage}
                  </pre>
                  {detail.data.errorStack ? (
                    <pre className="mt-2 whitespace-pre-wrap font-mono text-[0.7rem] text-fg-muted">
                      {detail.data.errorStack}
                    </pre>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-dim">Payload</h4>
            <JsonViewer value={detail.data.payload} />
            {detail.data.state === "failed" ? (
              <div className="flex items-center gap-3">
                <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
                  {retry.isPending ? "Retrying…" : "Retry now"}
                </Button>
                {retry.isError ? (
                  <span className="text-xs text-err">
                    {String((retry.error as Error | undefined)?.message ?? retry.error)}
                  </span>
                ) : null}
                {retry.isSuccess ? (
                  <span className="text-xs text-ok">
                    ✓ re-queued as{" "}
                    <code className="font-mono">
                      {(retry.data as { id?: string } | undefined)?.id?.slice(0, 8)}…
                    </code>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : detail.isError ? (
          <PageError>Failed to load job.</PageError>
        ) : (
          <PageLoading>Loading job…</PageLoading>
        )}
      </DialogContent>
    </Dialog>
  );
}
