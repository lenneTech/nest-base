import { Logger } from "@nestjs/common";

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
 * been attempted at least that many times are dead-lettered (marked
 * processed so they leave the queue). The attempt counter is tracked
 * in-memory (a `Map<entryId, attemptCount>`) — sufficient for
 * single-process deployments. In multi-replica deployments the
 * counter resets on pod restart; see OPEN_QUESTIONS.md MAJ-3.
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

export interface OutboxWorkerResult {
  /** Entries that ran ALL dispatchers successfully and were marked processed. */
  processed: number;
  /** Entries that exceeded maxAttempts and were moved to dead-letter. */
  deadLettered: number;
}

export class OutboxWorker {
  /**
   * In-memory attempt counter. Keyed by entry id. Survives across
   * `runOnce()` calls within the same process lifetime; reset on
   * process restart.
   *
   * NOTE (MAJ-3): this counter resets on pod restart in multi-replica
   * deployments, making `maxAttempts` ineffective as a dead-letter
   * guard after a restart. See OPEN_QUESTIONS.md for the persistence
   * migration plan.
   */
  private readonly attemptCounts = new Map<string, number>();
  private readonly logger = new Logger("OutboxWorker");

  constructor(
    private readonly storage: OutboxStorage,
    private readonly dispatchers: OutboxDispatcher[],
    private readonly options: OutboxWorkerOptions,
  ) {}

  /**
   * Process one batch and return a result object with `processed` (all
   * dispatchers succeeded) and `deadLettered` (exceeded maxAttempts) counts.
   */
  async runOnce(): Promise<OutboxWorkerResult> {
    const batch = await this.storage.claimBatch(this.options.batchSize);
    if (batch.length === 0) return { processed: 0, deadLettered: 0 };

    // Snapshot the completion timestamp once so all entries in this batch
    // share the same processed_at value — avoids per-entry drift from
    // dispatch I/O latency.
    const processedAt = new Date();
    let processedCount = 0;
    let deadLetteredCount = 0;
    for (const entry of batch) {
      // Retry-cap guard: if this entry has already been attempted
      // maxAttempts times, dead-letter it (mark processed so it
      // leaves the queue and operator monitoring can detect the drop).
      const prevAttempts = this.attemptCounts.get(entry.id) ?? 0;
      if (this.options.maxAttempts !== undefined && prevAttempts >= this.options.maxAttempts) {
        // Log at error level so on-call alerts fire — silent discard
        // was the original Fix #9 behaviour but left no signal (MAJ-4).
        this.logger.error(
          { entryId: entry.id, type: entry.type, attempts: prevAttempts },
          "outbox: entry exceeded maxAttempts — moved to dead-letter",
        );
        await this.storage.markProcessed(entry.id, processedAt);
        this.attemptCounts.delete(entry.id);
        deadLetteredCount++;
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
        // Mark processed per-entry (NIT-3) — each successful dispatch
        // records its own processedAt so the timestamp is accurate
        // relative to when the dispatcher finished, not the batch start.
        await this.storage.markProcessed(entry.id, new Date());
        // Clear the counter on success — no need to keep stale entries.
        this.attemptCounts.delete(entry.id);
        processedCount++;
      }
    }
    return { processed: processedCount, deadLettered: deadLetteredCount };
  }
}
