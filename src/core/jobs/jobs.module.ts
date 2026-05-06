import {
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { InMemoryJobQueue } from "./job-queue.js";
import { type PgBossLike, PgBossScheduledJobScheduler } from "./scheduled-job-pgboss-scheduler.js";
import {
  DiscoveryScheduledJobRegistry,
  SCHEDULED_JOB_REGISTRY,
  type ScheduledJobRegistry,
} from "./scheduled-job.registry.js";

const PG_BOSS = Symbol.for("lt:PgBoss");

/**
 * Resolves the pg-boss adapter — returns a real client when
 * `FEATURE_JOBS_PG_BOSS=true` AND `DATABASE_URL` is set; otherwise
 * `null`. Tests + dev runs without pg-boss take the no-op path the
 * scheduler tolerates by design.
 */
async function resolvePgBoss(): Promise<PgBossLike | null> {
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
    typeof (instance as { stop?: unknown }).stop === "function"
  ) {
    return instance as PgBossLike;
  }
  return null;
}

@Injectable()
export class JobQueueService extends InMemoryJobQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("JobQueueService");

  async onModuleInit(): Promise<void> {
    this.start();
    this.logger.log("job queue started (in-memory adapter)");
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
      useFactory: (boss: PgBossLike | null, registry: ScheduledJobRegistry) =>
        new PgBossScheduledJobScheduler({ boss, registry }),
      inject: [PG_BOSS, SCHEDULED_JOB_REGISTRY],
    },
  ],
  exports: [JobQueueService, SCHEDULED_JOB_REGISTRY],
})
export class JobsModule {}
