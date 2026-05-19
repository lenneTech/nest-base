import {
  Inject,
  Injectable,
  Logger,
  Module,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { OutboxRecorder, type OutboxEntry, type OutboxStorage } from "./outbox.js";
import { OutboxWorker, type OutboxDispatcher, type OutboxWorkerResult } from "./outbox-worker.js";
import { PrismaOutboxStorage } from "./outbox.prisma.js";

export const OUTBOX_STORAGE = Symbol.for("lt:OutboxStorage");
export const OUTBOX_DISPATCHERS = Symbol.for("lt:OutboxDispatchers");

/**
 * In-memory OutboxStorage for single-process deployments (tests, dev without
 * a DATABASE_URL). Not safe for multi-replica use — use PrismaOutboxStorage.
 *
 * Exported so story tests can exercise the retry / inFlight behaviour directly
 * without bootstrapping a full NestJS module.
 *
 * Design note on inFlight: we intentionally do NOT use a permanent inFlight
 * set here. PrismaOutboxStorage prevents double-claiming via `processedAt IS
 * NULL` sentinel rows + `SELECT FOR UPDATE SKIP LOCKED`. In the single-process
 * in-memory case there is no concurrent-caller race (one setInterval ticks
 * runOnce() sequentially) so an inFlight set only causes entries whose
 * dispatcher threw to disappear permanently — the inFlight entry is never
 * cleared, claimBatch() filters it out, and the entry is silently lost.
 * Filtering by `processedAt === null` alone is the correct at-least-once
 * contract for a single-process store.
 */
export class InMemoryOutboxStorage implements OutboxStorage {
  private readonly entries: OutboxEntry[] = [];
  private readonly processed = new Set<string>();

  async append(entry: OutboxEntry): Promise<void> {
    this.entries.push(entry);
  }
  async claimBatch(limit: number): Promise<OutboxEntry[]> {
    const batch = this.entries.filter((e) => !this.processed.has(e.id)).slice(0, limit);
    // Set claimedAt to mirror PrismaOutboxStorage — keeps both adapters
    // symmetric so resetStaleSentinels logic works correctly in either impl.
    const now = new Date();
    for (const e of batch) {
      e.claimedAt = now;
    }
    return batch;
  }
  async markProcessed(id: string, _processedAt: Date): Promise<boolean> {
    void _processedAt;
    if (this.processed.has(id)) return false;
    this.processed.add(id);
    return true;
  }

  async incrementDispatchAttemptCount(id: string): Promise<number> {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return 0;
    entry.dispatchAttemptCount = (entry.dispatchAttemptCount ?? 0) + 1;
    return entry.dispatchAttemptCount;
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

  constructor(
    @Inject(OUTBOX_STORAGE) storage: OutboxStorage,
    @Inject(OUTBOX_DISPATCHERS) dispatchers: OutboxDispatcher[],
    private readonly recorder: OutboxRecorderProvider,
    // Optional so that when no DATABASE_URL is set, NestJS does not fail
    // to resolve PrismaOutboxStorage (it is still registered but the DB
    // connection is absent — the null guard below makes the calls safe).
    @Optional() private readonly prismaStorage: PrismaOutboxStorage | null,
  ) {
    this.worker = new OutboxWorker(storage, dispatchers, { batchSize: 50 });
  }

  async onModuleInit(): Promise<void> {
    // Only run DB-backed operations when a real database is configured.
    // The in-memory adapter starts fresh each boot so these steps are no-ops there.
    if (process.env.DATABASE_URL && this.prismaStorage) {
      // Reset stale in-flight sentinel rows left by a previous process crash.
      // Without this, rows marked with processed_at = epoch by a crashed worker
      // would stay stuck forever — the claimBatch WHERE clause only touches
      // processed_at IS NULL rows.
      try {
        const reset = await this.prismaStorage.resetStaleSentinels();
        if (reset > 0) {
          this.logger.warn(`outbox: reset ${reset} stale sentinel row(s) from previous crash`);
        }
      } catch (err) {
        // Non-fatal: stranded sentinels will remain but at-least-once delivery
        // is preserved for all non-sentinel rows. Log and continue.
        this.logger.warn(`outbox: failed to reset stale sentinels: ${err}`);
      }

      // Seed nextSeq from the DB max(seq) so cross-restart seq collisions
      // are prevented.
      try {
        const max = await this.prismaStorage.maxSeq();
        this.recorder.initSeq(max + 1);
      } catch (err) {
        // Non-fatal: seq may collide on rare restart during heavy load,
        // but dispatch ordering degrades gracefully (at-least-once still holds).
        this.logger.warn(`outbox: failed to seed nextSeq from DB: ${err}`);
      }
    }
    // 1s setInterval for single-process deployments. For multi-replica
    // deployments, upgrade to a distributed lock / BullMQ repeatable
    // job so only one replica dispatches per tick.
    this.timer = setInterval(() => {
      this.worker.runOnce().catch((err) => this.logger.error(err));
    }, 1000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Test hook. */
  async tickOnce(): Promise<OutboxWorkerResult> {
    return this.worker.runOnce();
  }
}

/**
 * OutboxModule — provides `OutboxRecorderProvider` (for write paths)
 * and runs `OutboxWorker` as a per-second tick lifecycle hook.
 * Dispatchers are injected via `OUTBOX_DISPATCHERS` multi-provider;
 * default list is empty. Webhook + Realtime modules append their
 * dispatchers.
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
    OutboxRecorderProvider,
    OutboxWorkerLifecycle,
  ],
  exports: [OutboxRecorderProvider, OUTBOX_STORAGE, OUTBOX_DISPATCHERS],
})
export class OutboxModule {}
