import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { BullMQJobQueue, type RedisDuplex } from "./bullmq-job-queue.js";
import { type PgBossLike, PgBossScheduledJobScheduler } from "./scheduled-job-pgboss-scheduler.js";
import {
  DiscoveryScheduledJobRegistry,
  SCHEDULED_JOB_REGISTRY,
  type ScheduledJobRegistry,
} from "./scheduled-job.registry.js";

const PG_BOSS = Symbol.for("lt:PgBoss");
const BULLMQ_REDIS = Symbol.for("lt:BullMQRedis");

/**
 * Combined pg-boss surface used by `JobQueueService` (durable enqueue
 * + cron scheduling). The cron-only scheduler keeps using
 * `PgBossLike`; the additional `send` channel powers ad-hoc
 * `enqueue(name, payload)`. The `work` signatures of the two parent
 * interfaces differ only in handler-arg arity (cron handler takes no
 * args; queue handler takes a jobs array) — both compatible with
 * pg-boss's runtime that always passes a jobs array which the cron
 * variant ignores. Defined as an inline shape to avoid the TS
 * structural-merge conflict on overlapping property names.
 */
interface PgBossFull {
  start(): Promise<unknown>;
  work(name: string, handler: (...args: unknown[]) => Promise<unknown> | unknown): Promise<unknown>;
  schedule(name: string, cron: string): Promise<unknown>;
  stop(): Promise<unknown>;
  send(name: string, data: unknown): Promise<string | null>;
}

/**
 * Resolves the pg-boss adapter — returns a real client when
 * `FEATURE_JOBS_PG_BOSS=true` AND `DATABASE_URL` is set; otherwise
 * `null`. Tests + dev runs without pg-boss take the no-op path the
 * scheduler tolerates by design.
 */
async function resolvePgBoss(): Promise<PgBossFull | null> {
  const enabled =
    process.env.FEATURE_JOBS_PG_BOSS === "true" || process.env.FEATURE_JOBS_PGBOSS === "true";
  const url = process.env.DATABASE_URL;
  if (!enabled || !url) return null;
  const mod = await import("pg-boss");
  const Ctor: new (cs: string) => unknown = mod.PgBoss;
  const instance = new Ctor(url);
  if (
    typeof instance === "object" &&
    instance !== null &&
    typeof (instance as { start?: unknown }).start === "function" &&
    typeof (instance as { work?: unknown }).work === "function" &&
    typeof (instance as { schedule?: unknown }).schedule === "function" &&
    typeof (instance as { stop?: unknown }).stop === "function" &&
    typeof (instance as { send?: unknown }).send === "function"
  ) {
    return instance as PgBossFull;
  }
  return null;
}

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
 *   1. `FEATURE_JOBS_BULLMQ=true` AND `REDIS_URL` set → `BullMQJobQueue`
 *   2. `FEATURE_JOBS_PG_BOSS=true` AND `DATABASE_URL` set → `PgBossJobQueue`
 *   3. Otherwise → `InMemoryJobQueue` (via `BullMQJobQueue(null)`)
 *
 * The service itself always exposes the same `InMemoryJobQueue` surface
 * so callers are agnostic of the backing store.
 */
@Injectable()
export class JobQueueService extends BullMQJobQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("JobQueueService");
  private readonly pgBoss: PgBossFull | null;

  constructor(
    @Optional() @Inject(BULLMQ_REDIS) redis: RedisDuplex | null = null,
    @Optional() @Inject(PG_BOSS) boss: PgBossFull | null = null,
  ) {
    // When BullMQ Redis is available, use it. When pg-boss is available
    // but BullMQ is not, we still use BullMQJobQueue(null) as the base
    // (InMemory) and layer pg-boss on top in enqueue/register.
    super(redis);
    this.pgBoss = boss;
  }

  override register<TPayload>(
    name: string,
    handler: (payload: TPayload) => Promise<void> | void,
  ): void {
    super.register(name, handler);
    // Optionally layer pg-boss on top when BullMQ is not active.
    if (this.pgBoss && !this.isBullMQActive()) {
      void this.registerPgBossWorker(name, handler);
    }
  }

  override async enqueue<TPayload>(name: string, payload: TPayload): Promise<string> {
    const jobId = await super.enqueue(name, payload);
    // Mirror to pg-boss when BullMQ is not active.
    if (this.pgBoss && !this.isBullMQActive()) {
      await this.sendToPgBoss(name, payload, jobId);
    }
    return jobId;
  }

  async onModuleInit(): Promise<void> {
    this.start();
    if (this.isBullMQActive()) {
      this.logger.log("job queue started (BullMQ-backed adapter)");
    } else if (this.pgBoss) {
      this.logger.log("job queue started (pg-boss-backed adapter)");
    } else {
      this.logger.log("job queue started (in-memory adapter)");
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stop();
    this.logger.log("job queue stopped");
  }

  private isBullMQActive(): boolean {
    // BullMQ is active when the BULLMQ_REDIS provider resolved a client.
    return process.env.FEATURE_JOBS_BULLMQ === "true" && !!process.env.REDIS_URL;
  }

  private async registerPgBossWorker<TPayload>(
    name: string,
    handler: (payload: TPayload) => Promise<void> | void,
  ): Promise<void> {
    if (!this.pgBoss) return;
    try {
      await this.pgBoss.work(name, async (...args: unknown[]) => {
        const jobs = (args[0] ?? []) as Array<{ data?: { payload?: unknown } }>;
        for (const job of jobs) {
          const payload = (job.data?.payload ?? null) as TPayload;
          await handler(payload);
        }
      });
    } catch (err) {
      this.bullmqLogger.error(
        `pg-boss work() registration for ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async sendToPgBoss<TPayload>(
    name: string,
    payload: TPayload,
    jobId: string,
  ): Promise<void> {
    if (!this.pgBoss) return;
    try {
      await this.pgBoss.send(name, { jobId, payload });
    } catch (err) {
      this.bullmqLogger.warn(
        `pg-boss send() failed for ${name} (job will run in-process only): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/**
 * JobsModule — provides `JobQueueService` with `OnModuleInit`/`OnModuleDestroy`
 * lifecycle hooks. The backing store is selected at startup:
 *   - BullMQ when `FEATURE_JOBS_BULLMQ=true` AND `REDIS_URL` set
 *   - pg-boss when `FEATURE_JOBS_PG_BOSS=true` AND `DATABASE_URL` set
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
      provide: PG_BOSS,
      useFactory: () => resolvePgBoss(),
    },
    {
      provide: BULLMQ_REDIS,
      useFactory: () => resolveBullMQRedis(),
    },
    {
      provide: PgBossScheduledJobScheduler,
      useFactory: (boss: PgBossFull | null, registry: ScheduledJobRegistry) =>
        new PgBossScheduledJobScheduler({ boss: boss as PgBossLike | null, registry }),
      inject: [PG_BOSS, SCHEDULED_JOB_REGISTRY],
    },
  ],
  exports: [JobQueueService, SCHEDULED_JOB_REGISTRY],
})
export class JobsModule {}
