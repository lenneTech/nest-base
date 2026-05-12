import type { OutboxEntry, OutboxStorage } from "./outbox.js";

/**
 * Outbox Worker.
 *
 * Reads claimed outbox entries in order, fans them out to every
 * registered dispatcher (webhooks / realtime / search index), and
 * marks each entry processed only when EVERY dispatcher returned
 * successfully. A single failing dispatcher does not stop sibling
 * dispatchers from running; the entry stays unprocessed and gets
 * retried on the next tick (at-least-once semantics — dispatchers
 * are responsible for their own idempotency).
 */

export interface OutboxDispatcher {
  name: string;
  dispatch(entry: OutboxEntry): Promise<void>;
}

export interface OutboxWorkerOptions {
  batchSize: number;
}

export class OutboxWorker {
  constructor(
    private readonly storage: OutboxStorage,
    private readonly dispatchers: OutboxDispatcher[],
    private readonly options: OutboxWorkerOptions,
  ) {}

  /**
   * Process one batch and return the number of entries that ran ALL
   * dispatchers successfully (and got marked processed). Failed
   * entries stay unprocessed for the next tick.
   */
  async runOnce(): Promise<number> {
    const batch = await this.storage.claimBatch(this.options.batchSize);
    if (batch.length === 0) return 0;

    // Record the claim time ONCE before the dispatch loop so every entry in
    // this batch shares the same `processed_at` timestamp. Using dispatch-
    // completion time (new Date() inside the loop) would give a variable,
    // network-I/O-dependent value that is semantically meaningless (L1 fix).
    const claimedAt = new Date();
    let processedCount = 0;
    for (const entry of batch) {
      const results = await Promise.all(
        this.dispatchers.map(async (d) => {
          try {
            await d.dispatch(entry);
            const success: { ok: true } = { ok: true };
            return success;
          } catch (error) {
            return {
              ok: false,
              error: error instanceof Error ? error : new Error(String(error)),
            } as const;
          }
        }),
      );

      const allOk = results.every((r) => r.ok);
      if (allOk) {
        await this.storage.markProcessed(entry.id, claimedAt);
        processedCount++;
      }
    }
    return processedCount;
  }
}
