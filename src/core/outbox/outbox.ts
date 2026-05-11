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
  // TODO(seq): initialize from DB max(seq) at startup to prevent cross-restart
  // duplicates. In production (Prisma-backed OutboxStorage) restarts reset
  // nextSeq to 1, which can produce duplicate seq values if pre-restart rows
  // are still unprocessed. Fix: OutboxModule.onModuleInit() should query
  // MAX(seq) from outbox_entries and call recorder.initSeq(maxSeq + 1).
  // The claimBatch ordering (ORDER BY seq ASC) remains correct because
  // processed_at IS NULL filters already-dispatched rows, but seq collisions
  // across restarts can reorder otherwise-equal-timestamp entries unexpectedly.
  private nextSeq = 1;

  constructor(private readonly storage: OutboxStorage) {}

  async record(input: RecordInput): Promise<OutboxEntry> {
    if (!input.type) throw new Error("outbox: type is required");
    const entry: OutboxEntry = {
      id: uuidV7(),
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

  async claim(limit: number): Promise<OutboxEntry[]> {
    return this.storage.claimBatch(limit);
  }

  async markProcessed(id: string): Promise<boolean> {
    return this.storage.markProcessed(id, new Date());
  }
}
