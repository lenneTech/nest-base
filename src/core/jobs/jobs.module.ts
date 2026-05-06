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

import { PgBossJobQueue } from "./pg-boss-job-queue.js";
import { type PgBossLike, PgBossScheduledJobScheduler } from "./scheduled-job-pgboss-scheduler.js";
import {
  DiscoveryScheduledJobRegistry,
  SCHEDULED_JOB_REGISTRY,
  type ScheduledJobRegistry,
} from "./scheduled-job.registry.js";

const PG_BOSS = Symbol.for("lt:PgBoss");

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
  const enabled = process.env.FEATURE_JOBS_PG_BOSS === "true";
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
 * JobQueueService — extends `PgBossJobQueue` so the runtime contract
 * is "in-process queue with pg-boss durability layered on top when
 * available". Iter-215 CF.JOBS.01 closure: when
 * `FEATURE_JOBS_PG_BOSS=true` AND `DATABASE_URL` is set, the
 * `enqueue(name, payload)` API writes to pg-boss for restart-
 * survival. When pg-boss is unavailable (tests, dev without flag),
 * the queue falls through to the in-memory implementation —
 * byte-for-byte identical to the iter-pre-215 behaviour.
 */
@Injectable()
export class JobQueueService extends PgBossJobQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("JobQueueService");

  constructor(@Optional() @Inject(PG_BOSS) boss: PgBossFull | null = null) {
    super(boss);
  }

  async onModuleInit(): Promise<void> {
    this.start();
    this.logger.log("job queue started (pg-boss-backed adapter)");
  }

  async onModuleDestroy(): Promise<void> {
    this.stop();
    this.logger.log("job queue stopped");
  }
}

/**
 * JobsModule — provides `JobQueueService` (an `InMemoryJobQueue`
 * subclass) with `OnModuleInit`/`OnModuleDestroy` lifecycle hooks.
 * Domain modules `register(name, handler)` from their own
 * `OnModuleInit` and `enqueue(name, payload)` whenever they need to
 * schedule async work.
 *
 * pg-boss-backed adapter swaps in via the `JOB_QUEUE` token once the
 * `pg-boss` schema migration lands.
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
      provide: PgBossScheduledJobScheduler,
      useFactory: (boss: PgBossFull | null, registry: ScheduledJobRegistry) =>
        new PgBossScheduledJobScheduler({ boss: boss as PgBossLike | null, registry }),
      inject: [PG_BOSS, SCHEDULED_JOB_REGISTRY],
    },
  ],
  exports: [JobQueueService, SCHEDULED_JOB_REGISTRY],
})
export class JobsModule {}
