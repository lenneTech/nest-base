/**
 * `/dev/jobs` — Jobs-Dashboard for the in-memory queue (and any future
 * pg-boss-backed adapter that exposes the same `/dev/jobs/*` JSON
 * contract).
 *
 * Two tabs:
 *   - **Queues** — per-queue counts, p95 latency, failure rate
 *   - **Jobs**   — paginated, state-filterable listing with a drawer
 *                  that shows the full payload + error + retry CTA
 *
 * The page polls both endpoints every 4 s while open. The Schedules /
 * Workers / Archive tabs from the issue are intentionally deferred —
 * pg-boss surface, separate slice (see issue #15 follow-up notes).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type Key, type ReactNode } from "react";

import { Button, Select, SelectItem, Tab, TabList, TabPanel, Tabs } from "../components/index.js";
import { JsonViewer } from "../components/JsonViewer.js";
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
        <div className="admin-empty">Failed to load job aggregates.</div>
      ) : (
        <div className="admin-empty">Loading job aggregates…</div>
      )}
    </AdminShell>
  );
}

function JobsBody({ aggregates }: { aggregates: JobAggregates }): ReactNode {
  const [queueFilter, setQueueFilter] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<Key>("queues");

  return (
    <>
      <SummaryTiles aggregates={aggregates} />
      <Tabs selectedKey={activeTab} onSelectionChange={setActiveTab}>
        <TabList aria-label="Jobs sections">
          <Tab id="queues">Queues</Tab>
          <Tab id="jobs">Jobs</Tab>
        </TabList>
        <TabPanel id="queues">
          <QueuesTab
            aggregates={aggregates}
            onQueueClick={(name) => {
              setQueueFilter(name);
              setActiveTab("jobs");
            }}
          />
        </TabPanel>
        <TabPanel id="jobs">
          <JobsTab
            queueFilter={queueFilter}
            onQueueFilterChange={setQueueFilter}
            stateFilter={stateFilter}
            onStateFilterChange={setStateFilter}
            queueOptions={aggregates.queues.map((q) => q.name)}
          />
        </TabPanel>
      </Tabs>
    </>
  );
}

function SummaryTiles({ aggregates }: { aggregates: JobAggregates }): ReactNode {
  const failurePct = (aggregates.failureRate * 100).toFixed(1);
  const p95 = aggregates.p95LatencyMs === null ? "—" : formatMs(aggregates.p95LatencyMs);
  return (
    <div className="feat-summary">
      <div className="feat-tile">
        <span className="feat-tile__label">Total jobs</span>
        <span className="feat-tile__value">{aggregates.totalJobs}</span>
      </div>
      <div className="feat-tile feat-tile--ok">
        <span className="feat-tile__label">Completed</span>
        <span className="feat-tile__value">{aggregates.totals.completed}</span>
      </div>
      <div className="feat-tile">
        <span className="feat-tile__label">Active / pending</span>
        <span className="feat-tile__value">
          {aggregates.totals.active + aggregates.totals.created + aggregates.totals.retry}
        </span>
      </div>
      <div className="feat-tile">
        <span className="feat-tile__label">Failed</span>
        <span className="feat-tile__value">{aggregates.totals.failed}</span>
      </div>
      <div className="feat-tile">
        <span className="feat-tile__label">Failure rate</span>
        <span className="feat-tile__value">{failurePct}%</span>
      </div>
      <div className="feat-tile">
        <span className="feat-tile__label">p95 latency</span>
        <span className="feat-tile__value">{p95}</span>
      </div>
    </div>
  );
}

interface QueuesTabProps {
  aggregates: JobAggregates;
  onQueueClick: (name: string) => void;
}

function QueuesTab({ aggregates, onQueueClick }: QueuesTabProps): ReactNode {
  if (aggregates.queues.length === 0) {
    return <div className="admin-empty">No queues active yet — enqueue a job to see it here.</div>;
  }
  return (
    <div className="admin-card">
      <table className="log-table">
        <thead>
          <tr>
            <th>Queue</th>
            <th style={{ textAlign: "right" }}>Total</th>
            <th style={{ textAlign: "right" }}>Active</th>
            <th style={{ textAlign: "right" }}>Completed</th>
            <th style={{ textAlign: "right" }}>Failed</th>
            <th style={{ textAlign: "right" }}>p95 latency</th>
            <th style={{ textAlign: "right" }}>Failure rate</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {aggregates.queues.map((queue) => (
            <tr key={queue.name}>
              <td>
                <strong>{queue.name}</strong>
              </td>
              <td style={{ textAlign: "right" }}>{queue.total}</td>
              <td style={{ textAlign: "right" }}>{queue.counts.active + queue.counts.created}</td>
              <td style={{ textAlign: "right" }}>{queue.counts.completed}</td>
              <td style={{ textAlign: "right" }}>{queue.counts.failed}</td>
              <td style={{ textAlign: "right" }}>
                {queue.p95LatencyMs === null ? "—" : formatMs(queue.p95LatencyMs)}
              </td>
              <td style={{ textAlign: "right" }}>{(queue.failureRate * 100).toFixed(1)}%</td>
              <td>
                <Button onPress={() => onQueueClick(queue.name)}>Filter jobs →</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
    <div className="admin-card">
      <div className="log-toolbar">
        <Select
          label="Queue"
          selectedKey={queueFilter || "all"}
          onSelectionChange={(key) => onQueueFilterChange(key === "all" ? "" : String(key))}
        >
          {queueChoices.map((name) => (
            <SelectItem key={name} id={name}>
              {name === "all" ? "All queues" : name}
            </SelectItem>
          ))}
        </Select>
        <Select
          label="State"
          selectedKey={stateFilter}
          onSelectionChange={(key) => onStateFilterChange(String(key))}
        >
          {STATE_FILTERS.map((opt) => (
            <SelectItem key={opt.id} id={opt.id}>
              {opt.label}
            </SelectItem>
          ))}
        </Select>
      </div>

      {list.data ? (
        list.data.jobs.length === 0 ? (
          <div className="admin-empty">No jobs match the current filters.</div>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Queue</th>
                <th>State</th>
                <th style={{ textAlign: "right" }}>Attempt</th>
                <th>Created</th>
                <th style={{ textAlign: "right" }}>Duration</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.jobs.map((job) => (
                <JobRow key={job.id} job={job} onInspect={() => setSelectedId(job.id)} />
              ))}
            </tbody>
          </table>
        )
      ) : list.isError ? (
        <div className="admin-empty">Failed to load jobs.</div>
      ) : (
        <div className="admin-empty">Loading jobs…</div>
      )}

      {selectedId ? <JobDrawer id={selectedId} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}

function JobRow({ job, onInspect }: { job: JobRecord; onInspect: () => void }): ReactNode {
  const created = new Date(job.createdAt).toISOString().slice(11, 19);
  const duration =
    job.startedAt !== undefined && job.completedAt !== undefined
      ? formatMs(job.completedAt - job.startedAt)
      : "—";
  return (
    <tr className={`log-row--${stateToLevel(job.state)}`}>
      <td>
        <code>{job.id.slice(0, 8)}…</code>
      </td>
      <td>{job.name}</td>
      <td>
        <span className={`log-level log-level--${stateToLevel(job.state)}`}>{job.state}</span>
      </td>
      <td style={{ textAlign: "right" }}>{job.attempt}</td>
      <td>{created}</td>
      <td style={{ textAlign: "right" }}>{duration}</td>
      <td>
        <Button onPress={onInspect}>Inspect</Button>
      </td>
    </tr>
  );
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
      // Refresh both the listing and the aggregates so the UI reflects
      // the new attempt without waiting for the next poll tick.
      queryClient.invalidateQueries({ queryKey: ["dev", "jobs"] });
    },
  });

  return (
    <div className="feat-restart is-visible" role="dialog" aria-label="Job detail">
      <div className="feat-restart__box" style={{ maxWidth: "48rem", textAlign: "left" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "1rem",
          }}
        >
          <h3 className="feat-restart__title">
            Job <code>{id.slice(0, 16)}…</code>
          </h3>
          <Button onPress={onClose}>Close</Button>
        </header>
        {detail.data ? (
          <div>
            <p className="feat-restart__msg">
              Queue <code>{detail.data.name}</code> · state{" "}
              <span className={`log-level log-level--${stateToLevel(detail.data.state)}`}>
                {detail.data.state}
              </span>{" "}
              · attempt {detail.data.attempt}
            </p>
            {detail.data.errorMessage ? (
              <div className="admin-card">
                <h4>Error</h4>
                <pre style={{ whiteSpace: "pre-wrap", color: "var(--text-bad, #ff6b6b)" }}>
                  {detail.data.errorMessage}
                </pre>
                {detail.data.errorStack ? (
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      fontSize: "0.78rem",
                      opacity: 0.6,
                    }}
                  >
                    {detail.data.errorStack}
                  </pre>
                ) : null}
              </div>
            ) : null}
            <h4>Payload</h4>
            <JsonViewer value={detail.data.payload} />
            {detail.data.state === "failed" ? (
              <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                <Button
                  variant="accent"
                  onPress={() => retry.mutate()}
                  isDisabled={retry.isPending}
                >
                  {retry.isPending ? "Retrying…" : "Retry now"}
                </Button>
                {retry.isError ? (
                  <span className="admin-meta">
                    {String((retry.error as Error | undefined)?.message ?? retry.error)}
                  </span>
                ) : null}
                {retry.isSuccess ? (
                  <span className="admin-meta">
                    ✓ re-queued as{" "}
                    <code>{(retry.data as { id?: string } | undefined)?.id?.slice(0, 8)}…</code>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : detail.isError ? (
          <div className="admin-empty">Failed to load job.</div>
        ) : (
          <div className="admin-empty">Loading job…</div>
        )}
      </div>
    </div>
  );
}

/**
 * Map a job state to the log-row CSS level so the existing
 * `log-row--info` / `log-row--error` styles colour the table without
 * a per-page stylesheet.
 */
function stateToLevel(state: JobState): "info" | "warn" | "error" | "debug" {
  if (state === "failed") return "error";
  if (state === "cancelled") return "warn";
  if (state === "completed") return "info";
  if (state === "active" || state === "retry") return "warn";
  return "debug";
}
