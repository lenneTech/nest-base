import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";

import { OutboxRecorder, type OutboxEntry, type OutboxStorage } from "./outbox.js";
import { OutboxWorker, type OutboxDispatcher } from "./outbox-worker.js";

export const OUTBOX_STORAGE = Symbol.for("lt:OutboxStorage");
export const OUTBOX_DISPATCHERS = Symbol.for("lt:OutboxDispatchers");

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

  constructor(
    @Inject(OUTBOX_STORAGE) storage: OutboxStorage,
    @Inject(OUTBOX_DISPATCHERS) dispatchers: OutboxDispatcher[],
  ) {
    this.worker = new OutboxWorker(storage, dispatchers, { batchSize: 50 });
  }

  async onModuleInit(): Promise<void> {
    // Tick every 1s; dispatchers handle backoff. In tests this fires
    // a few times during boot and is torn down on app close.
    this.timer = setInterval(() => {
      this.worker.runOnce().catch((err) => this.logger.error(err));
    }, 1000);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Test hook. */
  async tickOnce(): Promise<number> {
    return this.worker.runOnce();
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
    { provide: OUTBOX_STORAGE, useClass: InMemoryOutboxStorage },
    { provide: OUTBOX_DISPATCHERS, useValue: [] satisfies OutboxDispatcher[] },
    OutboxRecorderProvider,
    OutboxWorkerLifecycle,
  ],
  exports: [OutboxRecorderProvider, OUTBOX_STORAGE, OUTBOX_DISPATCHERS],
})
export class OutboxModule {}
