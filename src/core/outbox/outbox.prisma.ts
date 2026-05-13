import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { OutboxEntry, OutboxStorage } from "./outbox.js";

// Module-level constant so all three usages (claimBatch UPDATE, markProcessed
// WHERE, resetStaleSentinels WHERE) stay in sync if the sentinel value ever
// changes. Inlining three copies risked silent divergence (Finding 3).
//
// Far-future sentinel (MIN-2): using the Unix epoch (new Date(0)) risks
// treating legacy backfill rows with processed_at = epoch as in-flight.
// A sentinel in the far future (year 9999) is unambiguous — no legitimate
// dispatch timestamp will ever reach it.
const INFLIGHT_SENTINEL = new Date("9999-12-31T23:59:59.999Z").toISOString();

/**
 * Prisma-backed `OutboxStorage` (CF.RT.04 + CF.WH.06 + CF.JOBS.01 —
 * iter-107). Default storage when `DATABASE_URL` is set; replaces
 * the in-memory adapter that was the iter-13 baseline.
 *
 * Why $queryRawUnsafe / $executeRaw: the audit-extension and the
 * Prisma model-delegate accessors don't reach this class via the
 * Nest IoC Proxy (see iter-84 documentation). The raw-SQL surface
 * sidesteps the issue entirely and maps 1:1 to the OutboxEntry
 * Prisma model (`outbox_entries` table, snake_case columns via
 * `@map`).
 *
 * Persistence guarantee: rows survive restart. The `processed_at`
 * column is the watermark — `claimBatch` reads only rows where it
 * is NULL, ordered by `seq` so dispatch ordering survives restarts.
 */
@Injectable()
export class PrismaOutboxStorage implements OutboxStorage {
  constructor(private readonly prisma: PrismaService) {}

  async append(entry: OutboxEntry): Promise<void> {
    const payloadJson = JSON.stringify(entry.payload ?? null);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO outbox_entries
         (id, seq, tenant_id, type, payload, occurred_at, processed_at, claimed_at)
       VALUES
         ($1::uuid, $2::int, $3::uuid, $4, $5::jsonb, $6::timestamp, $7::timestamp, $8::timestamp)`,
      entry.id,
      entry.seq,
      entry.tenantId,
      entry.type,
      payloadJson,
      entry.occurredAt.toISOString(),
      entry.processedAt ? entry.processedAt.toISOString() : null,
      entry.claimedAt ? entry.claimedAt.toISOString() : null,
    );
  }

  async claimBatch(limit: number): Promise<OutboxEntry[]> {
    if (limit <= 0) return [];
    // Transactional claim: SELECT FOR UPDATE SKIP LOCKED + in-flight mark
    // run inside a single Prisma transaction so the row-level lock is held
    // until both statements commit.  Without a wrapping transaction the lock
    // acquired by `FOR UPDATE SKIP LOCKED` is released immediately when the
    // auto-committed SELECT finishes, leaving a window where a concurrent
    // worker can claim the same rows before the caller finishes dispatching.
    //
    // The in-flight sentinel sets `processed_at` to the Unix epoch (a
    // distinguishable placeholder) so concurrent workers' WHERE clause
    // (`processed_at IS NULL`) skips already-claimed rows even after the
    // lock is released.  `markProcessed` overwrites the sentinel with the
    // real completion timestamp (`NOW()`).  A dispatch failure leaves the
    // sentinel in place; a periodic cleanup job (or the next deployment)
    // resets rows whose `claimed_at` is older than the dispatch deadline —
    // preserving at-least-once semantics without a long-held transaction.
    // `claimed_at` tracks when claimBatch wrote the sentinel so stale-
    // sentinel detection isn't fooled by backlog events with old
    // `occurred_at` values (Finding 1 fix).
    const rows = await this.prisma.$transaction(async (tx) => {
      const selected = (await tx.$queryRawUnsafe(
        `SELECT id, seq, tenant_id, type, payload, occurred_at, processed_at, claimed_at
           FROM outbox_entries
          WHERE processed_at IS NULL
          ORDER BY seq ASC
          LIMIT $1::int
          FOR UPDATE SKIP LOCKED`,
        limit,
      )) as Array<{
        id: string;
        seq: number;
        tenant_id: string;
        type: string;
        payload: unknown;
        occurred_at: Date;
        processed_at: Date | null;
        claimed_at: Date | null;
      }>;
      if (selected.length > 0) {
        const ids = selected.map((r) => r.id);
        // Mark rows as in-flight within the same transaction so the lock
        // persists through the UPDATE commit and concurrent workers see
        // processed_at IS NOT NULL immediately after commit.
        // Also stamp claimed_at = NOW() so resetStaleSentinels can measure
        // stale-ness from claim time, not event time (Finding 1 fix).
        const placeholders = ids.map((_: string, i: number) => `$${i + 2}::uuid`).join(", ");
        await tx.$executeRawUnsafe(
          `UPDATE outbox_entries
              SET processed_at = $1::timestamp,
                  claimed_at   = NOW()
            WHERE id IN (${placeholders})
              AND processed_at IS NULL`,
          INFLIGHT_SENTINEL,
          ...ids,
        );
      }
      return selected;
    });
    return rows.map(
      (r): OutboxEntry => ({
        id: r.id,
        seq: typeof r.seq === "number" ? r.seq : Number.parseInt(String(r.seq), 10),
        tenantId: r.tenant_id,
        type: r.type,
        payload: r.payload,
        occurredAt: r.occurred_at,
        processedAt: r.processed_at,
        claimedAt: r.claimed_at ?? undefined,
      }),
    );
  }

  async markProcessed(id: string, processedAt: Date): Promise<boolean> {
    // RETURNING gives us the row count without a second SELECT —
    // Prisma's $executeRaw returns the affected row count directly,
    // so we trust that.
    //
    // The WHERE clause matches both:
    //  - rows still at NULL (never claimed, defensive),
    //  - rows at the in-flight sentinel set by claimBatch.
    // This covers the case where claimBatch claimed a row and the
    // dispatcher succeeded.
    const affected = await this.prisma.$executeRawUnsafe(
      `UPDATE outbox_entries
          SET processed_at = $1::timestamp
        WHERE id = $2::uuid
          AND (processed_at IS NULL OR processed_at = $3::timestamp)`,
      processedAt.toISOString(),
      id,
      INFLIGHT_SENTINEL,
    );
    return Number(affected) > 0;
  }

  /**
   * Query the current maximum `seq` from the outbox table.
   * Returns 0 when the table is empty (first boot).
   * Used by OutboxModule.onModuleInit() to seed OutboxRecorder.nextSeq
   * so cross-restart seq collisions are prevented.
   */
  async maxSeq(): Promise<number> {
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT COALESCE(MAX(seq), 0) AS max_seq FROM outbox_entries`,
    )) as Array<{ max_seq: number | string }>;
    const raw = rows[0]?.max_seq ?? 0;
    return typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
  }

  /**
   * Reset stale in-flight sentinel rows from a previous process crash.
   *
   * `claimBatch` marks rows with `processed_at = epoch` as in-flight.
   * If the worker process crashes before calling `markProcessed`, those
   * rows stay at the epoch sentinel forever and are never retried because
   * the `claimBatch` WHERE clause filters `processed_at IS NULL`. This
   * startup sweep resets rows older than 5 minutes back to NULL so they
   * re-enter the dispatch queue on the next tick.
   *
   * Returns the number of rows reset.
   */
  async resetStaleSentinels(): Promise<number> {
    // Compare against claimed_at (when the sentinel was written) rather than
    // occurred_at (when the event was enqueued). A backlog event with old
    // occurred_at but a fresh claimed_at must NOT be reset — the worker may
    // still be dispatching it (Finding 1 fix).
    const affected = await this.prisma.$executeRawUnsafe(
      `UPDATE outbox_entries
          SET processed_at = NULL
        WHERE processed_at = $1::timestamp
          AND claimed_at < NOW() - INTERVAL '5 minutes'`,
      INFLIGHT_SENTINEL,
    );
    return Number(affected);
  }
}
