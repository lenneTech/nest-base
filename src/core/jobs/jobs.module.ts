import {
  Inject,
  Injectable,
  Logger,
  Module,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { BullMQJobQueue, type RedisDuplex } from "./bullmq-job-queue.js";
import { DiscoveryScheduledJobRegistry, SCHEDULED_JOB_REGISTRY } from "./scheduled-job.registry.js";

const BULLMQ_REDIS = Symbol.for("lt:BullMQRedis");

/**
 * Resolves an ioredis client for BullMQ — returns a real client when
 * `FEATURE_JOBS_BULLMQ=true` AND `REDIS_URL` is set; otherwise `null`.
 * When null, `BullMQJobQueue` falls back to `InMemoryJobQueue` behaviour.
 */
async function resolveBullMQRedis(): Promise<RedisDuplex | null> {
  const enabled = process.env.FEATURE_JOBS_BULLMQ === "true";
  const url = process.env.REDIS_URL;
  if (!enabled || !url) return null;
  try {
    const { default: Redis } = await import("ioredis");
    return new Redis(url) as unknown as RedisDuplex;
  } catch {
    return null;
  }
}

/**
 * JobQueueService — selects the appropriate queue backend at startup:
 *
 *   1. `FEATURE_JOBS_BULLMQ=true` AND `REDIS_URL` set → BullMQ (Redis-backed)
 *   2. Otherwise → `InMemoryJobQueue` (via `BullMQJobQueue(null)`)
 *
 * The service always exposes the same `InMemoryJobQueue` surface so
 * callers are agnostic of the backing store.
 */
@Injectable()
export class JobQueueService extends BullMQJobQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("JobQueueService");

  constructor(@Optional() @Inject(BULLMQ_REDIS) redis: RedisDuplex | null = null) {
    super(redis);
  }

  async onModuleInit(): Promise<void> {
    this.start();
    if (process.env.FEATURE_JOBS_BULLMQ === "true" && process.env.REDIS_URL) {
      this.logger.log("job queue started (BullMQ-backed adapter)");
    } else {
      this.logger.log("job queue started (in-memory adapter)");
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stop();
    this.logger.log("job queue stopped");
  }
}

/**
 * JobsModule — provides `JobQueueService` with `OnModuleInit`/`OnModuleDestroy`
 * lifecycle hooks. The backing store is selected at startup:
 *   - BullMQ when `FEATURE_JOBS_BULLMQ=true` AND `REDIS_URL` set
 *   - In-memory fallback otherwise
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    JobQueueService,
    DiscoveryScheduledJobRegistry,
    {
      provide: SCHEDULED_JOB_REGISTRY,
      useExisting: DiscoveryScheduledJobRegistry,
    },
    {
      provide: BULLMQ_REDIS,
      useFactory: () => resolveBullMQRedis(),
    },
  ],
  exports: [JobQueueService, SCHEDULED_JOB_REGISTRY],
})
export class JobsModule {}
