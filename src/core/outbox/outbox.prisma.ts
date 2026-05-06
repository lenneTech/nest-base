import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { OutboxEntry, OutboxStorage } from "./outbox.js";

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
         (id, seq, tenant_id, type, payload, occurred_at, processed_at)
       VALUES
         ($1::uuid, $2::int, $3::uuid, $4, $5::jsonb, $6::timestamp, $7::timestamp)`,
      entry.id,
      entry.seq,
      entry.tenantId,
      entry.type,
      payloadJson,
      entry.occurredAt.toISOString(),
      entry.processedAt ? entry.processedAt.toISOString() : null,
    );
  }

  async claimBatch(limit: number): Promise<OutboxEntry[]> {
    if (limit <= 0) return [];
    const rows = (await this.prisma.$queryRawUnsafe(
      `SELECT id, seq, tenant_id, type, payload, occurred_at, processed_at
         FROM outbox_entries
        WHERE processed_at IS NULL
        ORDER BY seq ASC
        LIMIT $1::int`,
      limit,
    )) as Array<{
      id: string;
      seq: number;
      tenant_id: string;
      type: string;
      payload: unknown;
      occurred_at: Date;
      processed_at: Date | null;
    }>;
    return rows.map(
      (r): OutboxEntry => ({
        id: r.id,
        seq: typeof r.seq === "number" ? r.seq : Number.parseInt(String(r.seq), 10),
        tenantId: r.tenant_id,
        type: r.type,
        payload: r.payload,
        occurredAt: r.occurred_at,
        processedAt: r.processed_at,
      }),
    );
  }

  async markProcessed(id: string, processedAt: Date): Promise<boolean> {
    // RETURNING gives us the row count without a second SELECT —
    // Prisma's $executeRaw returns the affected row count directly,
    // so we trust that.
    const affected = await this.prisma.$executeRawUnsafe(
      `UPDATE outbox_entries
          SET processed_at = $1::timestamp
        WHERE id = $2::uuid
          AND processed_at IS NULL`,
      processedAt.toISOString(),
      id,
    );
    return Number(affected) > 0;
  }
}
