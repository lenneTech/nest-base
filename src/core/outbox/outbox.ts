import { uuidV7 } from "../uuid/uuid-v7.js";

/**
 * Outbox-Pattern recorder.
 *
 * Atomic publish-with-persist: the domain operation writes to its
 * own tables AND inserts an outbox row in the same DB transaction.
 * A separate worker (next slice) reads outbox rows in order and
 * dispatches them to webhooks / realtime / search index. Storage
 * stays behind `OutboxStorage` so unit tests run DB-free; the
 * Prisma binding sits next to PrismaService.
 */

export interface OutboxEntry {
  id: string;
  /** Monotonic sequence number — claim ordering. */
  seq: number;
  tenantId: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
  processedAt: Date | null;
  /**
   * Set by `claimBatch` the moment the in-flight sentinel is written.
   * Used by `resetStaleSentinels` to measure stale-ness from claim time
   * rather than event-enqueue time — prevents false resets for backlog
   * events with old `occurredAt` values (Finding 1 fix).
   * `undefined` on rows not yet claimed (appended but not picked up).
   */
  claimedAt?: Date;
}

export interface OutboxStorage {
  append(entry: OutboxEntry): Promise<void>;
  claimBatch(limit: number): Promise<OutboxEntry[]>;
  markProcessed(id: string, processedAt: Date): Promise<boolean>;
}

export interface RecordInput {
  tenantId: string;
  type: string;
  payload: unknown;
}

export class OutboxRecorder {
  // Monotonic counter — initialized to 1 and bootstrapped from DB max(seq)
  // on startup by OutboxModule.onModuleInit() so seq values don't collide
  // across process restarts (seq ordering governs dispatch order).
  private nextSeq = 1;

  constructor(private readonly storage: OutboxStorage) {}

  /**
   * Seed the next sequence number from the DB max(seq) on startup.
   * Called by OutboxModule.onModuleInit() after querying MAX(seq) from
   * outbox_entries so cross-restart seq collisions are prevented.
   */
  initSeq(next: number): void {
    if (next > this.nextSeq) {
      this.nextSeq = next;
    }
  }

  async record(input: RecordInput): Promise<OutboxEntry> {
    if (!input.type) throw new Error("outbox: type is required");
    const entry: OutboxEntry = {
      id: uuidV7(),
      // In multi-pod deployments, two pods seeding from the same MAX(seq) can
      // emit duplicate seq values briefly at startup. claimBatch uses
      // SELECT FOR UPDATE SKIP LOCKED which is robust to duplicates — ordering
      // is best-effort, not strict.
      seq: this.nextSeq++,
      tenantId: input.tenantId,
      type: input.type,
      payload: input.payload,
      occurredAt: new Date(),
      processedAt: null,
    };
    await this.storage.append(entry);
    return entry;
  }

  async markProcessed(id: string): Promise<boolean> {
    return this.storage.markProcessed(id, new Date());
  }
}
