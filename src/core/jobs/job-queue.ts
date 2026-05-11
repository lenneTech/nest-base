import {
  buildJobAggregates,
  type JobAggregates,
  type JobRecord,
  type JobState,
} from "./dev-jobs-aggregations.js";
import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * Job-Queue contract.
 *
 * In-memory implementation is the reference + test substrate so worker
 * code is unit-testable without a database. The same surface is used by
 * the BullMQ adapter when Redis is available:
 *   - register(name, handler)
 *   - enqueue(name, payload)
 *   - start() / stop()
 *
 * `drain()` is the test-only helper that awaits an empty queue.
 *
 * Beyond the runtime surface the queue keeps a per-job `JobRecord`
 * with createdAt / startedAt / completedAt timestamps + the original
 * payload + the error captured on failure. The `/dev/jobs/*`
 * dashboard reads that history through `listJobs()` and `getAggregates()`.
 */

export type JobHandler<TPayload = unknown> = (payload: TPayload) => Promise<void> | void;

export interface JobResult {
  status: "pending" | "completed" | "failed";
  error?: Error;
}

export class JobHandlerNotRegisteredError extends Error {
  constructor(name: string) {
    super(`job handler not registered: ${name}`);
    this.name = "JobHandlerNotRegisteredError";
  }
}

export class JobNotFoundError extends Error {
  constructor(id: string) {
    super(`job not found: ${id}`);
    this.name = "JobNotFoundError";
  }
}

export class JobNotRetryableError extends Error {
  constructor(id: string, state: JobState) {
    super(`job ${id} is not retryable in state ${state}`);
    this.name = "JobNotRetryableError";
  }
}

export interface ListJobsOptions {
  state?: JobState;
  name?: string;
  /** Default cap to prevent runaway responses; the drawer asks for one record. */
  limit?: number;
}

interface QueuedJob {
  id: string;
}

interface MutableJobRecord extends JobRecord {
  state: JobState;
}

export class InMemoryJobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly queue: QueuedJob[] = [];
  private readonly history = new Map<string, MutableJobRecord>();
  /**
   * Insertion order tracked separately so listJobs() can return
   * newest-first without sorting on every call. Stable across retries:
   * the retry creates a *new* id and appends to the end.
   */
  private readonly historyOrder: string[] = [];
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();

  register<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    this.handlers.set(name, handler as JobHandler);
  }

  async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    return this.enqueueInternal({ name, payload, attempt: 1 });
  }

  /**
   * Re-run a previously failed job. Returns the new job id; the
   * original record stays in history with its terminal state. Throws
   * `JobNotFoundError` on unknown ids and `JobNotRetryableError` if
   * the job is still pending / completed / cancelled.
   */
  async retry(id: string): Promise<string> {
    const original = this.history.get(id);
    if (!original) throw new JobNotFoundError(id);
    if (original.state !== "failed") {
      throw new JobNotRetryableError(id, original.state);
    }
    return this.enqueueInternal({
      name: original.name,
      payload: original.payload,
      attempt: original.attempt + 1,
    });
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.scheduleProcess();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.inFlight;
  }

  async drain(): Promise<void> {
    while (this.queue.length > 0 || (await this.flushInFlight())) {
      await this.inFlight;
    }
  }

  jobResult(id: string): JobResult | undefined {
    const record = this.history.get(id);
    if (!record) return undefined;
    if (record.state === "completed") return { status: "completed" };
    if (record.state === "failed") {
      const error = new Error(record.errorMessage ?? "job failed");
      if (record.errorStack) error.stack = record.errorStack;
      return { status: "failed", error };
    }
    return { status: "pending" };
  }

  /**
   * Detail-view accessor for the dashboard drawer. Returns a defensive
   * copy so callers cannot mutate internal history.
   */
  getJob(id: string): JobRecord | undefined {
    const record = this.history.get(id);
    return record ? { ...record } : undefined;
  }

  /**
   * Enumerate the history newest-first. Filters and limit are applied
   * in-memory — the in-memory queue holds at most a handful of jobs
   * during a dev-server session, so a pass over the array is fine.
   */
  listJobs(options: ListJobsOptions = {}): JobRecord[] {
    const { state, name, limit } = options;
    const out: JobRecord[] = [];
    // Walk the order array in reverse (newest-first).
    for (let i = this.historyOrder.length - 1; i >= 0; i--) {
      const id = this.historyOrder[i];
      if (id === undefined) continue;
      const record = this.history.get(id);
      if (!record) continue;
      if (state && record.state !== state) continue;
      if (name && record.name !== name) continue;
      out.push({ ...record });
      if (limit !== undefined && out.length >= limit) break;
    }
    return out;
  }

  /**
   * Aggregate snapshot the `/dev/jobs/queues.json` endpoint serves.
   * Built from the unfiltered history so totals reflect everything
   * the queue has ever processed in the current process lifetime.
   */
  getAggregates(): JobAggregates {
    return buildJobAggregates(this.listJobs());
  }

  private async enqueueInternal(input: {
    name: string;
    payload: unknown;
    attempt: number;
  }): Promise<string> {
    if (!this.handlers.has(input.name)) {
      throw new JobHandlerNotRegisteredError(input.name);
    }
    const id = uuidV7();
    const record: MutableJobRecord = {
      id,
      name: input.name,
      state: "created",
      attempt: input.attempt,
      payload: input.payload,
      createdAt: Date.now(),
    };
    this.history.set(id, record);
    this.historyOrder.push(id);
    this.queue.push({ id });
    if (this.running) this.scheduleProcess();
    return id;
  }

  private async flushInFlight(): Promise<boolean> {
    await this.inFlight;
    return this.queue.length > 0;
  }

  private scheduleProcess(): void {
    // Swallowed by design — a single job failure must not stop the
    // processing loop; processOne() already marks the job as failed.
    this.inFlight = this.inFlight.then(() => this.processOne()).catch(() => {});
  }

  private async processOne(): Promise<void> {
    if (!this.running) return;
    const queued = this.queue.shift();
    if (!queued) return;
    const record = this.history.get(queued.id);
    if (!record) return;
    const handler = this.handlers.get(record.name);
    if (!handler) {
      record.state = "failed";
      record.errorMessage = `job handler not registered: ${record.name}`;
      record.completedAt = Date.now();
      return;
    }
    record.state = "active";
    record.startedAt = Date.now();
    try {
      await handler(record.payload);
      record.state = "completed";
      record.completedAt = Date.now();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      record.state = "failed";
      record.errorMessage = err.message;
      record.errorStack = err.stack;
      record.completedAt = Date.now();
    }
    if (this.running && this.queue.length > 0) this.scheduleProcess();
  }
}
