import {
  Inject,
  Injectable,
  Logger,
  Module,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import type { PgBossLike } from "../jobs/scheduled-job-pgboss-scheduler.js";
import { OutboxRecorder, type OutboxEntry, type OutboxStorage } from "./outbox.js";
import { OutboxWorker, type OutboxDispatcher } from "./outbox-worker.js";
import { PrismaOutboxStorage } from "./outbox.prisma.js";

export const OUTBOX_STORAGE = Symbol.for("lt:OutboxStorage");
export const OUTBOX_DISPATCHERS = Symbol.for("lt:OutboxDispatchers");
export const OUTBOX_PG_BOSS = Symbol.for("lt:OutboxPgBoss");

/** Pg-boss queue name + cron for the outbox dispatcher tick. */
export const OUTBOX_PGBOSS_QUEUE = "lt.outbox.dispatch";
export const OUTBOX_PGBOSS_CRON = "* * * * *";

class InMemoryOutboxStorage implements OutboxStorage {
  private readonly entries: OutboxEntry[] = [];
  private readonly processed = new Set<string>();
  async append(entry: OutboxEntry): Promise<void> {
    this.entries.push(entry);
  }
  async claimBatch(limit: number): Promise<OutboxEntry[]> {
    return this.entries.filter((e) => !this.processed.has(e.id)).slice(0, limit);
  }
  async markProcessed(id: string, _processedAt: Date): Promise<boolean> {
    void _processedAt;
    if (this.processed.has(id)) return false;
    this.processed.add(id);
    return true;
  }
}

@Injectable()
export class OutboxRecorderProvider extends OutboxRecorder {
  constructor(@Inject(OUTBOX_STORAGE) storage: OutboxStorage) {
    super(storage);
  }
}

@Injectable()
export class OutboxWorkerLifecycle implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("OutboxWorker");
  private readonly worker: OutboxWorker;
  private timer?: ReturnType<typeof setInterval>;
  private bossActive = false;

  constructor(
    @Inject(OUTBOX_STORAGE) storage: OutboxStorage,
    @Inject(OUTBOX_DISPATCHERS) dispatchers: OutboxDispatcher[],
    @Optional() @Inject(OUTBOX_PG_BOSS) private readonly boss: PgBossLike | null = null,
  ) {
    this.worker = new OutboxWorker(storage, dispatchers, { batchSize: 50 });
  }

  async onModuleInit(): Promise<void> {
    // Multi-instance deployments enable pg-boss so the outbox dispatch
    // tick is leader-claimed rather than running concurrently from
    // every replica. The cron granularity is 1 minute (pg-boss's
    // minimum) so a single-instance deployment that wants sub-second
    // dispatch keeps `FEATURE_JOBS_PG_BOSS=false` and falls back to
    // the 1s setInterval below.
    if (this.boss) {
      try {
        await this.boss.work(OUTBOX_PGBOSS_QUEUE, () => this.worker.runOnce());
        await this.boss.schedule(OUTBOX_PGBOSS_QUEUE, OUTBOX_PGBOSS_CRON);
        this.bossActive = true;
        this.logger.log(
          `outbox dispatch scheduled via pg-boss (queue="${OUTBOX_PGBOSS_QUEUE}", cron="${OUTBOX_PGBOSS_CRON}")`,
        );
        return;
      } catch (err) {
        this.logger.error(`pg-boss outbox scheduling failed; falling back to setInterval: ${err}`);
      }
    }
    // Fallback: 1s setInterval (single-instance only — multiple
    // replicas would each run the dispatcher concurrently). Tests
    // rely on this path because they don't bring up pg-boss.
    this.timer = setInterval(() => {
      this.worker.runOnce().catch((err) => this.logger.error(err));
    }, 1000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.bossActive = false;
  }

  /** Test hook. */
  async tickOnce(): Promise<number> {
    return this.worker.runOnce();
  }

  /** Test hook — surfaces which mode the lifecycle picked. */
  isPgBossActive(): boolean {
    return this.bossActive;
  }
}

/**
 * OutboxModule — provides `OutboxRecorderProvider` (for write paths)
 * and runs `OutboxWorker` as a per-second tick. Dispatchers are
 * injected via `OUTBOX_DISPATCHERS` multi-provider; default list is
 * empty. Webhook + Realtime modules append their dispatchers.
 *
 * In-memory storage is the default; Prisma-backed `outbox` table
 * adapter swaps in once the schema migration lands.
 */
@Module({
  providers: [
    PrismaOutboxStorage,
    {
      // Default to the Prisma-backed adapter when DATABASE_URL is set;
      // otherwise the in-memory baseline (test bootstraps that don't
      // bring up a Postgres testcontainer). The factory checks
      // `process.env.DATABASE_URL` at provider-init time so test
      // suites that set the env in `globalSetup` see the right
      // adapter.
      provide: OUTBOX_STORAGE,
      useFactory: (prismaStorage: PrismaOutboxStorage): OutboxStorage =>
        process.env.DATABASE_URL ? prismaStorage : new InMemoryOutboxStorage(),
      inject: [PrismaOutboxStorage],
    },
    { provide: OUTBOX_DISPATCHERS, useValue: [] satisfies OutboxDispatcher[] },
    {
      // Resolve a pg-boss client when FEATURE_JOBS_PG_BOSS=true +
      // DATABASE_URL is set. Mirrors `JobsModule.resolvePgBoss()` so
      // the two subsystems share the same gating contract.
      provide: OUTBOX_PG_BOSS,
      useFactory: () => resolveOutboxPgBoss(),
    },
    OutboxRecorderProvider,
    OutboxWorkerLifecycle,
  ],
  exports: [OutboxRecorderProvider, OUTBOX_STORAGE, OUTBOX_DISPATCHERS],
})
export class OutboxModule {}

async function resolveOutboxPgBoss(): Promise<PgBossLike | null> {
  const enabled = process.env.FEATURE_JOBS_PG_BOSS === "true";
  const url = process.env.DATABASE_URL;
  if (!enabled || !url) return null;
  // Lazy-load pg-boss so the in-memory test path doesn't pay the
  // module-resolution cost. The module's default export is a
  // constructor compatible with `PgBossLike`; we route through the
  // narrowed factory below to avoid sprinkling type casts in the
  // hot path.
  const mod = await import("pg-boss");
  return constructPgBoss(mod.PgBoss, url);
}

function constructPgBoss(Ctor: new (connectionString: string) => unknown, url: string): PgBossLike {
  const instance = new Ctor(url);
  // Narrow the unknown — runtime check before passing to consumers.
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
  throw new TypeError("pg-boss instance does not match expected shape");
}
