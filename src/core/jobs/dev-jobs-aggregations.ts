/**
 * Dev-Jobs Aggregations — pure planner for the Jobs-Dashboard.
 *
 * Takes a flat list of `JobRecord` rows (whatever the runner produced
 * — in-memory queue today, pg-boss tomorrow) and rolls them up into
 * the counters / latency stats / per-queue snapshots the dashboard
 * renders. No I/O, no clock, no database — given the same input the
 * output is deterministic.
 *
 * The runner-side counterparts (`InMemoryJobQueue.listJobs()` and a
 * future pg-boss adapter) live alongside the queue implementation so
 * this file can be unit-tested without booting a database.
 */

/**
 * State machine for jobs as the dashboard sees it. The in-memory
 * queue uses {created, active, completed, failed, cancelled, retry}
 * — pg-boss adds `expired`, which we map to `failed` to keep the
 * UI buckets manageable.
 */
export type JobState = "created" | "active" | "completed" | "failed" | "cancelled" | "retry";

export interface JobRecord {
  id: string;
  /** Queue / job-handler name. */
  name: string;
  state: JobState;
  /** 1-indexed attempt counter — first run is `1`, retries increment. */
  attempt: number;
  /** Caller-supplied payload. Stored verbatim so the drawer can show it. */
  payload: unknown;
  /** Epoch-ms when the job was enqueued. */
  createdAt: number;
  /** Epoch-ms when the worker picked the job up. */
  startedAt?: number;
  /** Epoch-ms when the job finished (completed or failed). */
  completedAt?: number;
  /** Error message captured on failure. */
  errorMessage?: string;
  /** Error stack captured on failure (if available). */
  errorStack?: string;
}

export interface StateCounts {
  created: number;
  active: number;
  completed: number;
  failed: number;
  cancelled: number;
  retry: number;
}

export interface QueueAggregate {
  name: string;
  total: number;
  counts: StateCounts;
  /** 95th-percentile completion latency in ms across completed jobs. */
  p95LatencyMs: number | null;
  /** Failed share of finished jobs (0..1). */
  failureRate: number;
}

export interface JobAggregates {
  totalJobs: number;
  totals: StateCounts;
  failureRate: number;
  p95LatencyMs: number | null;
  queues: QueueAggregate[];
}

function emptyCounts(): StateCounts {
  return { created: 0, active: 0, completed: 0, failed: 0, cancelled: 0, retry: 0 };
}

/**
 * Count jobs by state. Defensive against unknown future states (pg-boss
 * `expired` etc.) — anything outside the known buckets is silently
 * ignored so the totals still add up to the known list.
 */
export function countByState(records: readonly JobRecord[]): StateCounts {
  const counts = emptyCounts();
  for (const record of records) {
    if (record.state in counts) {
      counts[record.state] += 1;
    }
  }
  return counts;
}

/**
 * Extract completion durations (ms) from completed jobs that recorded
 * both `startedAt` and `completedAt`. Negative durations (clock skew,
 * malformed records) are dropped — they would distort percentiles.
 */
function completionDurations(records: readonly JobRecord[]): number[] {
  const durations: number[] = [];
  for (const record of records) {
    if (record.state !== "completed") continue;
    if (record.startedAt === undefined) continue;
    if (record.completedAt === undefined) continue;
    const duration = record.completedAt - record.startedAt;
    if (duration < 0) continue;
    durations.push(duration);
  }
  return durations;
}

/**
 * 95th-percentile completion latency in ms. Returns `null` when no
 * completed job has a recorded duration.
 *
 * Uses the simple "ceil(0.95 * N) - 1" index after sorting — sufficient
 * for the dashboard, no need for the linear-interpolation flavour.
 */
export function computeP95Latency(records: readonly JobRecord[]): number | null {
  const durations = completionDurations(records);
  if (durations.length === 0) return null;
  const sorted = durations.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return sorted[index] ?? null;
}

/**
 * Failed share of *finished* jobs (failed / (failed + completed)).
 * Returns `0` on an empty list to avoid NaN; pending / active jobs
 * are excluded — they are not yet failures.
 */
export function computeFailureRate(records: readonly JobRecord[]): number {
  let failed = 0;
  let completed = 0;
  for (const record of records) {
    if (record.state === "failed") failed += 1;
    else if (record.state === "completed") completed += 1;
  }
  const total = failed + completed;
  if (total === 0) return 0;
  return failed / total;
}

/**
 * Group jobs by queue name and emit a per-queue aggregate. Queues are
 * returned alphabetically sorted so the rendered table is stable
 * across reloads (no flicker as job counts wiggle).
 */
export function aggregateJobsByQueue(records: readonly JobRecord[]): QueueAggregate[] {
  const grouped = new Map<string, JobRecord[]>();
  for (const record of records) {
    const list = grouped.get(record.name) ?? [];
    list.push(record);
    grouped.set(record.name, list);
  }
  const queues: QueueAggregate[] = [];
  for (const [name, list] of grouped) {
    queues.push({
      name,
      total: list.length,
      counts: countByState(list),
      p95LatencyMs: computeP95Latency(list),
      failureRate: computeFailureRate(list),
    });
  }
  queues.sort((a, b) => a.name.localeCompare(b.name));
  return queues;
}

/**
 * Top-level snapshot the `/dev/jobs/queues.json` endpoint returns.
 * Combines totals, the per-queue list, and global p95 + failure-rate
 * so the dashboard hero can render without a second pass.
 */
export function buildJobAggregates(records: readonly JobRecord[]): JobAggregates {
  return {
    totalJobs: records.length,
    totals: countByState(records),
    failureRate: computeFailureRate(records),
    p95LatencyMs: computeP95Latency(records),
    queues: aggregateJobsByQueue(records),
  };
}
