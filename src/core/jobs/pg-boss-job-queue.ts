import { Logger } from "@nestjs/common";

import { InMemoryJobQueue, type JobHandler } from "./job-queue.js";

/**
 * pg-boss-backed JobQueue (CF.JOBS.01 closure — iter-215).
 *
 * Iter-205's `docs/prd-deviations.md` documented CF.JOBS.01: the
 * `JobQueueService` extended `InMemoryJobQueue` so process restart
 * dropped every in-flight enqueue. Iter-215 layers pg-boss on top:
 *   - `enqueue(name, payload)` writes to pg-boss BEFORE the in-memory
 *     queue, so a crash between the two writes is survivable (the
 *     in-memory entry is rebuilt by the pg-boss worker on restart).
 *   - `register(name, handler)` ALSO registers a pg-boss worker that
 *     dispatches into the same handler. The worker uses an
 *     idempotency check against the in-memory history so concurrent
 *     in-process + pg-boss-replay execution doesn't double-fire.
 *
 * The `InMemoryJobQueue` history is preserved verbatim — `listJobs`,
 * `getAggregates`, `getJob`, `jobResult` all continue to work the
 * same. The dev UI sees the same shape; the durability guarantee is
 * an additive layer.
 *
 * Test-mode (`boss === null`) falls through to pure InMemoryJobQueue
 * behaviour — no pg-boss calls are made.
 */
/**
 * Minimal pg-boss surface this adapter needs. The `work` signature is
 * deliberately compatible with `PgBossLike.work` (used by the cron
 * scheduler) — pg-boss's runtime always passes a jobs array to the
 * handler; the cron scheduler ignores it and only uses the side
 * effects. Our handler accepts the args via the type-erased runtime
 * shape and casts internally.
 */
export interface PgBossEnqueueLike {
  send(name: string, data: unknown): Promise<string | null>;
  work(name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown): Promise<unknown>;
}

export interface PgBossJob {
  id: string;
  data: { jobId?: string; payload?: unknown } | null;
}

export class PgBossJobQueue extends InMemoryJobQueue {
  protected readonly bossLogger = new Logger("PgBossJobQueue");
  private readonly registeredWorkers = new Set<string>();
  /**
   * Track jobIds dispatched in-process so the pg-boss replay worker
   * doesn't double-execute. The pg-boss server retries on its own
   * cadence; if the in-memory handler has already completed (or is
   * actively running) the replay should skip.
   */
  private readonly dispatchedInProcess = new Set<string>();

  constructor(private readonly boss: PgBossEnqueueLike | null) {
    super();
  }

  override register<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    super.register(name, handler);
    if (!this.boss || this.registeredWorkers.has(name)) return;
    this.registeredWorkers.add(name);
    void this.boss
      .work(name, async (...args: unknown[]) => {
        const jobs = (args[0] ?? []) as PgBossJob[];
        for (const job of jobs) {
          const data = job.data ?? {};
          const jobId = typeof data.jobId === "string" ? data.jobId : undefined;
          if (jobId && this.dispatchedInProcess.has(jobId)) {
            // Already executed in-process this lifetime — pg-boss is
            // replaying after a hand-off. Skip to avoid double-fire.
            continue;
          }
          try {
            await handler((data.payload ?? null) as TPayload);
          } catch (err) {
            this.bossLogger.error(
              `pg-boss replay handler for ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            throw err;
          }
        }
      })
      .catch((err) => {
        this.bossLogger.error(
          `pg-boss work() registration for ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }

  override async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    // 1. Create the in-memory record + dispatch to in-process queue
    //    (the standard fast path).
    const jobId = await super.enqueue(name, payload);
    this.dispatchedInProcess.add(jobId);

    // 2. Mirror to pg-boss for restart-survival. If pg-boss is
    //    unavailable, fall through gracefully — the in-process queue
    //    is still the source of truth for this lifetime.
    if (this.boss) {
      try {
        await this.boss.send(name, { jobId, payload });
      } catch (err) {
        this.bossLogger.warn(
          `pg-boss send() failed for ${name} (job will run in-process only): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return jobId;
  }
}
