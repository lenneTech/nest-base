import type { PrismaService } from "../prisma/prisma.service.js";
import type { IdempotencyRecord, IdempotencyStore } from "./idempotency.service.js";

/**
 * Prisma-backed `IdempotencyStore` (CF.STORAGE.01 closure — iter-179).
 *
 * Persists Stripe-style idempotency records to the
 * `idempotency_records` table so cached responses survive a process
 * restart. The service-facing record carries `expiresAt` as
 * epoch-ms; the Prisma column is `TIMESTAMP(3)` — this adapter
 * converts at the boundary.
 *
 * `put` uses `upsert` because the service refreshes the record after
 * a TTL miss — the second write must replace the first row, not
 * fail on the unique key.
 *
 * The matching in-memory adapter still ships in `idempotency.module.ts`;
 * the module's factory picks Prisma when the delegate is detected on
 * the `PrismaService` instance and falls back to in-memory when not
 * (e.g. when feature-gated tests construct a bare client without
 * regenerating).
 */

interface PrismaIdempotencyDelegate {
  findUnique(input: { where: { key: string } }): Promise<PrismaIdempotencyRow | null>;
  upsert(input: {
    where: { key: string };
    create: PrismaIdempotencyRow;
    update: Partial<PrismaIdempotencyRow>;
  }): Promise<PrismaIdempotencyRow>;
  delete(input: { where: { key: string } }): Promise<PrismaIdempotencyRow>;
  deleteMany(input: { where: { expiresAt: { lt: Date } } }): Promise<{ count: number }>;
}

interface PrismaIdempotencyClient {
  idempotencyRecord: PrismaIdempotencyDelegate;
}

interface PrismaIdempotencyRow {
  key: string;
  userId: string | null;
  requestHash: string;
  status: number;
  body: unknown;
  expiresAt: Date;
  createdAt?: Date;
}

export class PrismaIdempotencyStore implements IdempotencyStore {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<IdempotencyRecord | null> {
    const row = await this.client().idempotencyRecord.findUnique({ where: { key } });
    return row ? this.fromRow(row) : null;
  }

  async put(record: IdempotencyRecord): Promise<void> {
    const row = this.toRow(record);
    await this.client().idempotencyRecord.upsert({
      where: { key: row.key },
      create: row,
      update: {
        userId: row.userId,
        requestHash: row.requestHash,
        status: row.status,
        body: row.body,
        expiresAt: row.expiresAt,
      },
    });
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client().idempotencyRecord.delete({ where: { key } });
    } catch {
      // Best-effort — a missing row is treated as a no-op so the
      // periodic cleanup never fails on a record that already expired
      // and was reaped by a concurrent cleanup tick.
    }
  }

  /**
   * Cleanup-cron entry point: delete every row whose `expiresAt` is
   * older than `cutoffMs`. The `expiresAt` index from migration
   * `20260506100000_idempotency_records` makes this O(log N).
   */
  async deleteOlderThan(cutoffMs: number): Promise<number> {
    const result = await this.client().idempotencyRecord.deleteMany({
      where: { expiresAt: { lt: new Date(cutoffMs) } },
    });
    return result.count;
  }

  private client(): PrismaIdempotencyClient {
    const erased: unknown = this.prisma;
    return erased as PrismaIdempotencyClient;
  }

  private toRow(record: IdempotencyRecord): PrismaIdempotencyRow {
    return {
      key: record.key,
      userId: record.userId ?? null,
      requestHash: record.requestHash,
      status: record.status,
      body: record.body,
      expiresAt: new Date(record.expiresAt),
    };
  }

  private fromRow(row: PrismaIdempotencyRow): IdempotencyRecord {
    const out: IdempotencyRecord = {
      key: row.key,
      requestHash: row.requestHash,
      status: row.status,
      body: row.body,
      expiresAt: row.expiresAt.getTime(),
    };
    if (row.userId !== null && row.userId !== undefined) out.userId = row.userId;
    return out;
  }
}

/**
 * Runtime feature-detection — returns true when the resolved Prisma
 * client exposes the `idempotencyRecord` delegate. Tests that flip
 * the feature flag without regenerating the Prisma client land in
 * the false branch and the module falls back to in-memory.
 */
export function hasPrismaIdempotencyDelegate(prisma: PrismaService): boolean {
  const erased: unknown = prisma;
  const client = erased as { idempotencyRecord?: unknown };
  return typeof client.idempotencyRecord === "object" && client.idempotencyRecord !== null;
}
