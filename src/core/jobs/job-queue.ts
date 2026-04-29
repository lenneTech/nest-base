import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * Job-Queue contract (PLAN.md §32 Phase 5).
 *
 * pg-boss in production; the in-memory implementation here is the
 * reference + the test substrate so worker code is unit-testable
 * without a database. Surface mirrors what pg-boss exposes:
 *   - register(name, handler)
 *   - enqueue(name, payload)
 *   - start() / stop()
 *
 * `drain()` is the test-only helper that awaits an empty queue.
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

interface QueuedJob {
  id: string;
  name: string;
  payload: unknown;
}

export class InMemoryJobQueue {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly queue: QueuedJob[] = [];
  private readonly results = new Map<string, JobResult>();
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();

  register<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    this.handlers.set(name, handler as JobHandler);
  }

  async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    if (!this.handlers.has(name)) {
      throw new JobHandlerNotRegisteredError(name);
    }
    const id = uuidV7();
    this.queue.push({ id, name, payload });
    this.results.set(id, { status: "pending" });
    if (this.running) this.scheduleProcess();
    return id;
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
    return this.results.get(id);
  }

  private async flushInFlight(): Promise<boolean> {
    await this.inFlight;
    return this.queue.length > 0;
  }

  private scheduleProcess(): void {
    this.inFlight = this.inFlight.then(() => this.processOne()).catch(() => {});
  }

  private async processOne(): Promise<void> {
    if (!this.running) return;
    const job = this.queue.shift();
    if (!job) return;
    const handler = this.handlers.get(job.name);
    if (!handler) {
      this.results.set(job.id, {
        status: "failed",
        error: new JobHandlerNotRegisteredError(job.name),
      });
      return;
    }
    try {
      await handler(job.payload);
      this.results.set(job.id, { status: "completed" });
    } catch (error) {
      this.results.set(job.id, {
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
    if (this.running && this.queue.length > 0) this.scheduleProcess();
  }
}
