import { Logger } from "@nestjs/common";

import {
  buildJobAggregates,
  type JobAggregates,
  type JobRecord,
  type JobState,
} from "./dev-jobs-aggregations.js";
import {
  JobNotFoundError,
  JobNotRetryableError,
  type JobHandler,
  type ListJobsOptions,
} from "./job-queue.js";

/**
 * Minimal ioredis surface BullMQ needs. Defined as an interface so
 * the adapter can be tested without a live Redis instance — the
 * module factory supplies either a real ioredis client or null, and
 * `BullMQJobQueue` handles both.
 */
export interface RedisDuplex {
  duplicate(): RedisDuplex;
  disconnect(): void;
}

/**
 * Map a raw BullMQ job state string to the `JobState` the Hub UI knows.
 *
 * BullMQ states: waiting, waiting-children, prioritized, active,
 * completed, failed, delayed, paused, unknown.
 */
function mapBullMQState(raw: string): JobState {
  switch (raw) {
    case "active":
      return "active";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "delayed":
      return "retry";
    case "waiting":
    case "waiting-children":
    case "prioritized":
    case "paused":
    default:
      return "created";
  }
}

/**
 * Convert a BullMQ `Job` instance to the flat `JobRecord` the Hub reads.
 * The queue name is passed in because `Job` does not carry it.
 */
async function toJobRecord(
  job: {
    id?: string | null;
    data: unknown;
    timestamp: number;
    processedOn?: number | null;
    finishedOn?: number | null;
    failedReason?: string;
    attemptsMade: number;
    getState(): Promise<string>;
  },
  queueName: string,
): Promise<JobRecord> {
  const rawState = await job.getState();
  return {
    id: job.id!,
    name: queueName,
    state: mapBullMQState(rawState),
    attempt: job.attemptsMade + 1, // BullMQ counts from 0; Hub shows 1-indexed
    payload: job.data,
    createdAt: job.timestamp,
    startedAt: job.processedOn ?? undefined,
    completedAt: job.finishedOn ?? undefined,
    errorMessage: job.failedReason ?? undefined,
  };
}

// The full set of BullMQ job states we enumerate when listing.
const BULLMQ_JOB_STATES = [
  "waiting",
  "active",
  "completed",
  "failed",
  "delayed",
  "paused",
] as const;

type BullMQJobShape = {
  id?: string | null;
  data: unknown;
  timestamp: number;
  processedOn?: number | null;
  finishedOn?: number | null;
  failedReason?: string;
  attemptsMade: number;
  getState(): Promise<string>;
};

type BullMQQueue = {
  name: string;
  add(name: string, data: unknown, opts?: unknown): Promise<{ id?: string | null }>;
  getJobs(types: readonly string[], start?: number, end?: number): Promise<Array<BullMQJobShape>>;
  getJob(id: string): Promise<BullMQJobShape | null | undefined>;
  close(): Promise<void>;
};

type BullMQWorker = {
  on(event: string, handler: (...args: unknown[]) => void): void;
  close(): Promise<void>;
};

/**
 * In-process fallback when Redis is unavailable (no `REDIS_URL`).
 *
 * Implements the same surface as a BullMQ Queue + Worker pair using
 * simple in-memory maps so the Hub and unit tests work without Redis.
 * Only used when `redis === null`.
 */
class InProcessQueue implements BullMQQueue {
  readonly name: string;
  private readonly logger: Logger;
  private readonly records = new Map<
    string,
    {
      id: string;
      data: unknown;
      timestamp: number;
      processedOn?: number;
      finishedOn?: number;
      failedReason?: string;
      attemptsMade: number;
      state: JobState;
    }
  >();
  private readonly pendingIds: string[] = [];
  private handler?: (data: unknown) => Promise<unknown>;
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(name: string) {
    this.name = name;
    this.logger = new Logger(`InProcessQueue[${name}]`);
  }

  setHandler(handler: (data: unknown) => Promise<unknown>): void {
    this.handler = handler;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleProcess();
  }

  stop(): void {
    this.running = false;
  }

  async drain(): Promise<void> {
    // If the queue is stopped, nothing will consume pendingIds — break
    // immediately rather than busy-looping forever (M1 fix).
    while (this.pendingIds.length > 0) {
      if (!this.running) break;
      await this.inFlight;
    }
  }

  async add(
    _name: string,
    data: unknown,
    opts?: { jobId?: string; attemptsMade?: number },
  ): Promise<{ id?: string | null }> {
    const id = opts?.jobId ?? crypto.randomUUID();
    const record = {
      id,
      data,
      timestamp: Date.now(),
      attemptsMade: opts?.attemptsMade ?? 0,
      state: "created" as JobState,
    };
    this.records.set(id, record);
    this.pendingIds.push(id);
    if (this.running) this.scheduleProcess();
    return { id };
  }

  async getJobs(_types: readonly string[]): Promise<Array<BullMQJobShape>> {
    return [...this.records.values()].map((r) => this.wrapRecord(r));
  }

  async getJob(id: string): Promise<BullMQJobShape | null> {
    const r = this.records.get(id);
    if (!r) return null;
    return this.wrapRecord(r);
  }

  async close(): Promise<void> {
    this.running = false;
  }

  private wrapRecord(r: {
    id: string;
    data: unknown;
    timestamp: number;
    processedOn?: number;
    finishedOn?: number;
    failedReason?: string;
    attemptsMade: number;
    state: JobState;
  }): BullMQJobShape {
    return {
      id: r.id,
      data: r.data,
      timestamp: r.timestamp,
      processedOn: r.processedOn,
      finishedOn: r.finishedOn,
      failedReason: r.failedReason,
      attemptsMade: r.attemptsMade,
      getState: async (): Promise<string> => {
        // Map JobState back to a BullMQ-style string for mapBullMQState().
        switch (r.state) {
          case "active":
            return "active";
          case "completed":
            return "completed";
          case "failed":
            return "failed";
          case "retry":
            return "delayed";
          default:
            return "waiting";
        }
      },
    };
  }

  private scheduleProcess(): void {
    this.inFlight = this.inFlight
      .then(() => this.processOne())
      .catch((err: unknown) => this.logger.error("InProcessQueue scheduling error", err));
  }

  private async processOne(): Promise<void> {
    if (!this.running || !this.handler) return;
    const id = this.pendingIds.shift();
    if (!id) return;
    const record = this.records.get(id);
    if (!record) return;
    record.state = "active";
    record.processedOn = Date.now();
    try {
      await this.handler(record.data);
      record.state = "completed";
      record.finishedOn = Date.now();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record.state = "failed";
      record.failedReason = msg;
      record.finishedOn = Date.now();
    }
    if (this.running && this.pendingIds.length > 0) this.scheduleProcess();
  }
}

/**
 * BullMQ-only JobQueue (issue #141).
 *
 * Reads and writes jobs exclusively from/to Redis via BullMQ.
 * `InMemoryJobQueue` is no longer in the inheritance chain — it may
 * still be used as a lightweight test double by unit tests that need
 * it, but it is not the production code path.
 *
 * When `redis === null` (unit tests / dev without REDIS_URL), an
 * `InProcessQueue` provides the same surface using in-memory maps.
 * This keeps all unit story tests green without requiring a live Redis.
 *
 * Hub reads (`listJobs`, `getJob`, `getAggregates`) go to BullMQ
 * directly so the dashboard reflects the true state of the job store
 * rather than a process-local snapshot that evaporates on restart.
 */
export class BullMQJobQueue {
  protected readonly bullmqLogger = new Logger("BullMQJobQueue");

  // BullMQ Queue instances keyed by queue name.
  private readonly queues = new Map<string, BullMQQueue>();
  // BullMQ Worker instances keyed by queue name.
  private readonly workers = new Map<string, BullMQWorker>();
  // In-process queues used when redis === null.
  private readonly inProcessQueues = new Map<string, InProcessQueue>();
  // Tracks whether start() has been called so late-registered queues
  // (registered after onModuleInit) are started immediately.
  private started = false;

  constructor(protected readonly redis: RedisDuplex | null) {}

  /**
   * Register a handler for a named job type. Creates a BullMQ Worker
   * (or an in-process equivalent) that processes jobs from that queue.
   */
  register<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    if (!this.redis) {
      // In-process fallback — no BullMQ needed.
      const q = this.getOrCreateInProcessQueue(name);
      q.setHandler(async (data) => handler(data as TPayload));
      // If start() was already called (e.g. onModuleInit already ran),
      // start this queue immediately so enqueue() + drain() work.
      if (this.started) q.start();
      return;
    }
    // Fire-and-forget: registerBullMQWorker internally catches and logs all
    // errors, so no outer handler is needed. Re-throwing inside .catch()
    // would create an unhandled rejection with no additional benefit.
    void this.registerBullMQWorker(name, handler);
  }

  /**
   * Enqueue a job by name. Returns the new job id.
   */
  async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    if (!this.redis) {
      const q = this.getOrCreateInProcessQueue(name);
      const job = await q.add("run", payload);
      // Guard against the (theoretically impossible) case where the
      // in-process queue returns no id — fail loudly rather than
      // propagating undefined to callers (M6 fix).
      if (!job.id) throw new Error(`BullMQ job enqueue returned no id for queue "${name}"`);
      return job.id;
    }
    const queue = await this.getOrCreateBullMQQueue(name);
    const job = await queue.add("run", payload);
    if (!job.id) throw new Error(`BullMQ job enqueue returned no id for queue "${name}"`);
    return job.id;
  }

  /**
   * List jobs across all known queues. Applies state/name/limit filters.
   * Results are returned newest-first (sorted by `createdAt` descending).
   */
  async listJobs(options: ListJobsOptions = {}): Promise<JobRecord[]> {
    const { state, name, limit } = options;
    const queueNames = this.knownQueueNames();
    const allRecords: JobRecord[] = [];

    for (const queueName of queueNames) {
      if (name && queueName !== name) continue;
      const jobs = await this.fetchJobsFromQueue(queueName);
      allRecords.push(...jobs);
    }

    // Sort newest-first by createdAt.
    allRecords.sort((a, b) => b.createdAt - a.createdAt);

    const filtered = state ? allRecords.filter((r) => r.state === state) : allRecords;
    return limit !== undefined ? filtered.slice(0, limit) : filtered;
  }

  /**
   * Fetch a single job record by id. Searches all known queues.
   */
  async getJob(id: string): Promise<JobRecord | undefined> {
    for (const queueName of this.knownQueueNames()) {
      const record = await this.fetchJobFromQueue(queueName, id);
      if (record) return record;
    }
    return undefined;
  }

  /**
   * Aggregate snapshot for the `/hub/jobs/queues.json` endpoint.
   * Built by running `buildJobAggregates` over the full job list.
   */
  async getAggregates(): Promise<JobAggregates> {
    const all = await this.listJobs();
    return buildJobAggregates(all);
  }

  /**
   * Re-enqueue a failed job as a NEW job. Returns the new job id; the
   * original record stays in the store with its `failed` state.
   * Throws `JobNotFoundError` on unknown ids and `JobNotRetryableError`
   * when the job is not in the `failed` state.
   */
  async retry(id: string): Promise<string> {
    const record = await this.getJob(id);
    if (!record) throw new JobNotFoundError(id);
    if (record.state !== "failed") throw new JobNotRetryableError(id, record.state);

    if (!this.redis) {
      // For the in-process queue inherit the attempt count from the original
      // so the Hub shows attempt=2 on the first retry — matching BullMQ's
      // native incrementing behaviour (BullMQ counts from 0; attempt=record.attempt
      // is already 1-indexed, so the retried job starts at the next attempt).
      const q = this.getOrCreateInProcessQueue(record.name);
      if (this.started) q.start();
      const job = await q.add("run", record.payload, { attemptsMade: record.attempt });
      if (!job.id) throw new Error(`BullMQ job retry returned no id for queue "${record.name}"`);
      return job.id;
    }
    return this.enqueue(record.name, record.payload);
  }

  /**
   * Start in-process queues (no-op for BullMQ — Workers start on construction).
   */
  async start(): Promise<void> {
    this.started = true;
    for (const q of this.inProcessQueues.values()) {
      q.start();
    }
  }

  /**
   * Stop all queues and workers.
   */
  async stop(): Promise<void> {
    for (const q of this.inProcessQueues.values()) {
      q.stop();
    }
    for (const [name, worker] of this.workers) {
      try {
        await worker.close();
      } catch (err) {
        this.bullmqLogger.warn(`Failed to close BullMQ worker for ${name}: ${err}`);
      }
    }
    for (const [name, queue] of this.queues) {
      try {
        await queue.close();
      } catch (err) {
        this.bullmqLogger.warn(`Failed to close BullMQ queue for ${name}: ${err}`);
      }
    }
    this.workers.clear();
    this.queues.clear();
  }

  /**
   * Test-only: drain all in-process queues until empty.
   */
  async drain(): Promise<void> {
    for (const q of this.inProcessQueues.values()) {
      await q.drain();
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private knownQueueNames(): string[] {
    if (!this.redis) {
      return [...this.inProcessQueues.keys()];
    }
    return [...this.queues.keys()];
  }

  private getOrCreateInProcessQueue(name: string): InProcessQueue {
    let q = this.inProcessQueues.get(name);
    if (!q) {
      q = new InProcessQueue(name);
      this.inProcessQueues.set(name, q);
    }
    return q;
  }

  private async getOrCreateBullMQQueue(name: string): Promise<BullMQQueue> {
    if (this.queues.has(name)) return this.queues.get(name)!;
    const { Queue } = await import("bullmq");
    const connection = this.redis!.duplicate();
    // removeOnComplete / removeOnFail keep Redis memory bounded by
    // automatically pruning job records after completion or failure.
    // Without these, BullMQ accumulates job records indefinitely in
    // Redis — the `bullmq-cleanup-job-planner.ts` would otherwise need
    // to be wired to a scheduled job to prune them (M4 fix).
    const queue = new Queue(name, {
      connection: connection as never,
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
      },
    }) as unknown as BullMQQueue & {
      on(event: string, handler: (...args: unknown[]) => void): void;
    };
    // Prevent unhandled 'error' event crash on BullMQ Queue-level errors
    // (distinct from ioredis connection errors, which are already handled on
    // the ioredis client). BullMQ emits its own error events; without a
    // listener Node/Bun would throw an uncaught 'error' event.
    queue.on("error", (err: unknown) => {
      this.bullmqLogger.error(
        `BullMQ queue "${name}" error: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    this.queues.set(name, queue);
    return queue;
  }

  private async registerBullMQWorker<TPayload>(
    name: string,
    handler: JobHandler<TPayload>,
  ): Promise<void> {
    if (this.workers.has(name)) return;
    try {
      const { Worker } = await import("bullmq");
      // Ensure the queue entry exists so `listJobs` can find it.
      await this.getOrCreateBullMQQueue(name);
      const connection = this.redis!.duplicate();
      const worker = new Worker(
        name,
        async (job) => {
          const payload = job.data as TPayload;
          await handler(payload);
        },
        { connection: connection as never },
      ) as unknown as BullMQWorker;
      worker.on("failed", (job, err) => {
        this.bullmqLogger.error(
          `BullMQ worker for ${name} failed job ${(job as { id?: string })?.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      worker.on("error", (err) => {
        // Prevent unhandled 'error' event crash on Redis auth failures,
        // network drops, or TLS rejections — the worker reconnects via
        // its own retry logic; we surface the error through the logger
        // rather than crashing the process.
        this.bullmqLogger.error(
          `BullMQ worker "${name}" connection error: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      this.workers.set(name, worker);
    } catch (err) {
      this.bullmqLogger.error(
        `BullMQ Worker registration for ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async fetchJobsFromQueue(queueName: string): Promise<JobRecord[]> {
    if (!this.redis) {
      const q = this.inProcessQueues.get(queueName);
      if (!q) return [];
      const jobs = await q.getJobs(BULLMQ_JOB_STATES);
      return Promise.all(jobs.map((j) => toJobRecord(j, queueName)));
    }
    const queue = this.queues.get(queueName);
    if (!queue) return [];
    const jobs = await queue.getJobs(BULLMQ_JOB_STATES);
    return Promise.all(jobs.map((j) => toJobRecord(j, queueName)));
  }

  private async fetchJobFromQueue(queueName: string, id: string): Promise<JobRecord | undefined> {
    if (!this.redis) {
      const q = this.inProcessQueues.get(queueName);
      if (!q) return undefined;
      const job = await q.getJob(id);
      if (!job) return undefined;
      return toJobRecord(job, queueName);
    }
    const queue = this.queues.get(queueName);
    if (!queue) return undefined;
    const job = await queue.getJob(id);
    if (!job) return undefined;
    return toJobRecord(job, queueName);
  }
}
