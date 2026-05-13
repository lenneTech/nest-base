import { randomUUID } from "node:crypto";

import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from "@nestjs/common";

/**
 * GDPR export-job registry (CF.GDPR.* — iter-106).
 *
 * The PRD pins "/me/export async export jobs". The registry tracks
 * each request through its lifecycle:
 *
 *   PENDING → RUNNING → COMPLETED   (success)
 *   PENDING → RUNNING → FAILED      (synthesizer threw)
 *
 * The default implementation is in-memory + per-process — fine for
 * the framework default because GDPR exports are infrequent. Project
 * bootstraps replace the binding via the `GDPR_EXPORT_REGISTRY` token
 * with a Prisma-backed adapter when long-lived retention is needed
 * (a separate `gdpr_exports` table with the same shape).
 */

export type GdprExportStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export interface GdprExportJob {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string | null;
  readonly status: GdprExportStatus;
  readonly requestedAt: Date;
  readonly completedAt: Date | null;
  readonly payload: unknown;
  readonly error: string | null;
}

interface MutableGdprExportJob {
  id: string;
  userId: string;
  tenantId: string | null;
  status: GdprExportStatus;
  requestedAt: Date;
  completedAt: Date | null;
  payload: unknown;
  error: string | null;
  /** Handle returned by `setTimeout` for the eviction timer, if scheduled. */
  evictionTimer?: ReturnType<typeof setTimeout>;
}

export class GdprExportJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`gdpr export job "${jobId}" not found`);
    this.name = "GdprExportJobNotFoundError";
  }
}

export interface EnqueueGdprExportInput {
  readonly userId: string;
  readonly tenantId: string | null;
}

/** PENDING/RUNNING jobs older than this threshold are marked FAILED on sweep. */
const STALE_JOB_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
/** Sweep interval — checked every 10 minutes. */
const STALE_SWEEP_INTERVAL_MS = 10 * 60 * 1000;

@Injectable()
export class GdprExportJobRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GdprExportJobRegistry.name);
  private readonly jobs = new Map<string, MutableGdprExportJob>();
  private staleSweepTimer?: ReturnType<typeof setInterval>;

  /**
   * Start the periodic stale-job sweep. Jobs stuck in PENDING or RUNNING
   * for more than 2 hours are marked FAILED so the registry doesn't
   * accumulate zombie entries after pod crashes or lost context.
   */
  onModuleInit(): void {
    this.staleSweepTimer = setInterval(() => {
      this.sweepStaleJobs();
    }, STALE_SWEEP_INTERVAL_MS);
    // Allow the timer to be GC'd if the process exits without calling destroy
    if (this.staleSweepTimer.unref) {
      this.staleSweepTimer.unref();
    }
  }

  /**
   * Cancel all pending eviction timers on module teardown to prevent
   * open handles that would keep the process alive past its intended
   * lifetime (L2 fix).
   */
  onModuleDestroy(): void {
    if (this.staleSweepTimer !== undefined) {
      clearInterval(this.staleSweepTimer);
    }
    for (const job of this.jobs.values()) {
      if (job.evictionTimer !== undefined) {
        clearTimeout(job.evictionTimer);
      }
    }
    this.jobs.clear();
  }

  /**
   * Mark PENDING/RUNNING jobs that are older than `STALE_JOB_AGE_MS` as
   * FAILED. This prevents registry accumulation after pod crashes where
   * the in-progress job never receives a `complete()` or `fail()` call.
   */
  private sweepStaleJobs(): void {
    const cutoff = Date.now() - STALE_JOB_AGE_MS;
    for (const job of this.jobs.values()) {
      if (
        (job.status === "PENDING" || job.status === "RUNNING") &&
        job.requestedAt.getTime() < cutoff
      ) {
        job.status = "FAILED";
        job.completedAt = new Date();
        job.error = "job timed out — marked FAILED by stale-job sweep";
        this.logger.warn(`GDPR export job ${job.id} marked FAILED by stale-job sweep`);
        // Schedule eviction like regular failures.
        job.evictionTimer = setTimeout(() => this.jobs.delete(job.id), 24 * 60 * 60 * 1000);
      }
    }
  }

  enqueue(input: EnqueueGdprExportInput): GdprExportJob {
    const job: MutableGdprExportJob = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      status: "PENDING",
      requestedAt: new Date(),
      completedAt: null,
      payload: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  /**
   * Mark the job as currently running. Used by the
   * `GdprExportRunner` to advance the lifecycle for observability —
   * tests + admin tooling can detect "stuck" jobs by reading the
   * RUNNING state with a stale timestamp.
   */
  start(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new GdprExportJobNotFoundError(jobId);
    if (job.status !== "PENDING") return;
    job.status = "RUNNING";
  }

  complete(jobId: string, payload: unknown): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new GdprExportJobNotFoundError(jobId);
    if (job.status === "COMPLETED" || job.status === "FAILED") return;
    job.status = "COMPLETED";
    job.completedAt = new Date();
    job.payload = payload;
    // Evict terminal jobs after 24 h to prevent unbounded heap growth.
    // The in-memory registry is the default; Prisma-backed adapters retain
    // entries permanently in the DB and do not use this timer.
    // Store the handle so onModuleDestroy() can cancel it (L2 fix).
    job.evictionTimer = setTimeout(() => this.jobs.delete(jobId), 24 * 60 * 60 * 1000);
  }

  fail(jobId: string, err: Error): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new GdprExportJobNotFoundError(jobId);
    if (job.status === "COMPLETED" || job.status === "FAILED") return;
    job.status = "FAILED";
    job.completedAt = new Date();
    job.error = err.message;
    // Evict terminal jobs after 24 h to prevent unbounded heap growth.
    // Store the handle so onModuleDestroy() can cancel it (L2 fix).
    job.evictionTimer = setTimeout(() => this.jobs.delete(jobId), 24 * 60 * 60 * 1000);
  }

  get(jobId: string): GdprExportJob | null {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  listForUser(userId: string): readonly GdprExportJob[] {
    return [...this.jobs.values()].filter((j) => j.userId === userId).map((j) => ({ ...j }));
  }
}
