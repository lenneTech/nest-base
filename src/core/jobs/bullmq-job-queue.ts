import { Logger } from "@nestjs/common";

import { InMemoryJobQueue, type JobHandler } from "./job-queue.js";

/**
 * Minimal ioredis surface this adapter needs for connecting BullMQ.
 * Defined here rather than importing ioredis types directly so the
 * adapter can be instantiated without Redis in test environments.
 */
export interface RedisDuplex {
  duplicate(): RedisDuplex;
  disconnect(): void;
}

/**
 * BullMQ-backed JobQueue (issue #135).
 *
 * Layers BullMQ on top of `InMemoryJobQueue`:
 *   - When a real `ioredis` client is supplied, BullMQ `Queue` and
 *     `Worker` back the enqueue + process paths for restart-survival
 *     and multi-replica fan-out.
 *   - When `redis === null` (tests, dev without REDIS_URL), the
 *     in-memory queue handles everything — behaviour is byte-for-byte
 *     equivalent to the pre-#135 `InMemoryJobQueue`.
 *
 * `listJobs()`, `getAggregates()`, `getJob()`, `jobResult()` all
 * continue to read from the in-memory history so the dev-jobs dashboard
 * keeps working regardless of the backing store.
 */
export class BullMQJobQueue extends InMemoryJobQueue {
  protected readonly bullmqLogger = new Logger("BullMQJobQueue");

  /**
   * BullMQ `Queue` instances keyed by job name.
   * Only populated when `redis` is non-null.
   */
  private readonly queues = new Map<string, unknown>();
  /**
   * BullMQ `Worker` instances keyed by job name.
   * Only populated when `redis` is non-null.
   */
  private readonly workers = new Map<string, unknown>();

  constructor(private readonly redis: RedisDuplex | null) {
    super();
  }

  override register<TPayload>(name: string, handler: JobHandler<TPayload>): void {
    super.register(name, handler);
    if (!this.redis) return;
    // Lazy-import BullMQ so tests without Redis never load the module.
    void this.registerBullMQWorker(name, handler);
  }

  private async registerBullMQWorker<TPayload>(
    name: string,
    handler: JobHandler<TPayload>,
  ): Promise<void> {
    if (this.workers.has(name)) return;
    try {
      const { Worker } = await import("bullmq");
      const connection = this.redis!.duplicate();
      const worker = new Worker(
        name,
        async (job) => {
          const payload = job.data as TPayload;
          await handler(payload);
        },
        { connection: connection as never },
      );
      worker.on("failed", (job, err) => {
        this.bullmqLogger.error(
          `BullMQ worker for ${name} failed job ${job?.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      this.workers.set(name, worker);
    } catch (err) {
      this.bullmqLogger.error(
        `BullMQ Worker registration for ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  override async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    // Always enqueue in-memory first for the fast synchronous path.
    const jobId = await super.enqueue(name, payload);

    // Mirror to BullMQ for restart-survival when Redis is available.
    if (this.redis) {
      await this.enqueueToBullMQ(name, payload, jobId);
    }
    return jobId;
  }

  private async enqueueToBullMQ<TPayload>(
    name: string,
    payload: TPayload,
    jobId: string,
  ): Promise<void> {
    try {
      const { Queue } = await import("bullmq");
      if (!this.queues.has(name)) {
        const connection = this.redis!.duplicate();
        this.queues.set(name, new Queue(name, { connection: connection as never }));
      }
      const queue = this.queues.get(name) as {
        add: (name: string, data: unknown, opts?: unknown) => Promise<unknown>;
      };
      await queue.add(name, { jobId, payload }, { jobId });
    } catch (err) {
      this.bullmqLogger.warn(
        `BullMQ enqueue failed for ${name} (job runs in-process only): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  override async stop(): Promise<void> {
    await super.stop();
    // Gracefully close BullMQ workers and queues.
    for (const [name, worker] of this.workers) {
      try {
        await (worker as { close(): Promise<void> }).close();
      } catch (err) {
        this.bullmqLogger.warn(`Failed to close BullMQ worker for ${name}: ${err}`);
      }
    }
    for (const [name, queue] of this.queues) {
      try {
        await (queue as { close(): Promise<void> }).close();
      } catch (err) {
        this.bullmqLogger.warn(`Failed to close BullMQ queue for ${name}: ${err}`);
      }
    }
    this.workers.clear();
    this.queues.clear();
  }
}
