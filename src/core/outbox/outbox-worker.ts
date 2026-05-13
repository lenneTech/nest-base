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
 *
 * Retry cap (Fix #9): when `maxAttempts` is set, entries that have
 * been attempted at least that many times are silently dropped from
 * future batches. The attempt counter is tracked in-memory (a
 * `Map<entryId, attemptCount>`) — the `OutboxStorage` interface and
 * schema are not modified. This is sufficient for preventing poison-
 * pill entries from looping forever in a single-process deployment;
 * a persistent dead-letter store is out of scope for this slice.
 */

export interface OutboxDispatcher {
  name: string;
  dispatch(entry: OutboxEntry): Promise<void>;
}

export interface OutboxWorkerOptions {
  batchSize: number;
  /**
   * Maximum number of dispatch attempts per entry before the entry is
   * silently discarded from the retry queue.
   *
   * `undefined` (default) means no cap — preserves the original
   * at-least-once semantics for backwards compatibility. Set to `10`
   * for new deployments to prevent poison-pill entries from looping
   * indefinitely.
   */
  maxAttempts?: number;
}

export class OutboxWorker {
  /**
   * In-memory attempt counter. Keyed by entry id. Survives across
   * `runOnce()` calls within the same process lifetime; reset on
   * process restart.
   */
  private readonly attemptCounts = new Map<string, number>();

  constructor(
    private readonly storage: OutboxStorage,
    private readonly dispatchers: OutboxDispatcher[],
    private readonly options: OutboxWorkerOptions,
  ) {}

  /**
   * Process one batch and return the number of entries that ran ALL
   * dispatchers successfully (and got marked processed). Failed
   * entries stay unprocessed for the next tick (up to `maxAttempts`).
   */
  async runOnce(): Promise<number> {
    const batch = await this.storage.claimBatch(this.options.batchSize);
    if (batch.length === 0) return 0;

    // Snapshot the completion timestamp once so all entries in this batch
    // share the same processed_at value — avoids per-entry drift from
    // dispatch I/O latency.
    const processedAt = new Date();
    let processedCount = 0;
    for (const entry of batch) {
      // Retry-cap guard: if this entry has already been attempted
      // maxAttempts times, mark it as processed (dead-letter it) so
      // it no longer occupies the queue. The caller is responsible
      // for alerting on this via monitoring (Fix #9).
      const prevAttempts = this.attemptCounts.get(entry.id) ?? 0;
      if (this.options.maxAttempts !== undefined && prevAttempts >= this.options.maxAttempts) {
        // Dead-letter: mark processed so the entry leaves the queue.
        // In a future slice this could write to an actual dead-letter
        // table; for now we silently discard to prevent infinite loops.
        await this.storage.markProcessed(entry.id, processedAt);
        this.attemptCounts.delete(entry.id);
        continue;
      }

      // Increment attempt counter before dispatch so a crash during
      // dispatch still counts as an attempt on the next runOnce() call.
      this.attemptCounts.set(entry.id, prevAttempts + 1);

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
        await this.storage.markProcessed(entry.id, processedAt);
        // Clear the counter on success — no need to keep stale entries.
        this.attemptCounts.delete(entry.id);
        processedCount++;
      }
    }
    return processedCount;
  }
}
