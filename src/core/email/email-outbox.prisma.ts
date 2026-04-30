import type { PrismaClient } from "@prisma/client";

import {
  STALE_CLAIM_THRESHOLD_MS,
} from "./email-outbox-planner.js";
import type {
  AppendInput,
  EmailOutboxKind,
  EmailOutboxPayload,
  EmailOutboxRecord,
  EmailOutboxStorage,
} from "./email-outbox.js";
import type { EmailOutboxStatus } from "./email-outbox-planner.js";

/**
 * Prisma-backed EmailOutboxStorage.
 *
 * Persists outbox records to the `email_outbox` table declared in
 * `prisma/schema.prisma`. The in-memory storage in unit tests is the
 * dev-friendly fake; this class is the production default wired up
 * in `email-outbox.module.ts`.
 *
 * The `claim()` path uses a conditional `UPDATE … WHERE claimed_at
 * IS NULL OR claimed_at < (NOW() - interval)` so concurrent workers
 * never duplicate-dispatch a record; only the first transaction
 * flips `claimed_at` to the current timestamp, the others see a
 * zero-row affect and skip.
 *
 * Why a separate class instead of inlining into the recorder/worker:
 * the recorder + worker stay storage-agnostic (matches the rest of
 * the core's pure-planner / thin-runner split — every adapter
 * passes the same EmailOutboxStorage interface).
 */
type PrismaEmailOutboxModel = Pick<
  PrismaClient,
  "emailOutbox" | "$queryRaw" | "$executeRaw" | "$transaction"
>;

const STATUS_DB_TO_DOMAIN = {
  PENDING: "pending",
  SENT: "sent",
  DEAD_LETTER: "dead-letter",
} as const satisfies Record<string, EmailOutboxStatus>;

const STATUS_DOMAIN_TO_DB = {
  pending: "PENDING",
  sent: "SENT",
  "dead-letter": "DEAD_LETTER",
} as const satisfies Record<EmailOutboxStatus, "PENDING" | "SENT" | "DEAD_LETTER">;

const KIND_DB_TO_DOMAIN = {
  SEND: "send",
  SEND_TEMPLATE: "sendTemplate",
} as const satisfies Record<string, EmailOutboxKind>;

const KIND_DOMAIN_TO_DB = {
  send: "SEND",
  sendTemplate: "SEND_TEMPLATE",
} as const satisfies Record<EmailOutboxKind, "SEND" | "SEND_TEMPLATE">;

interface PrismaEmailOutboxRow {
  id: string;
  kind: keyof typeof KIND_DB_TO_DOMAIN;
  payload: unknown;
  idempotencyKey: string | null;
  status: keyof typeof STATUS_DB_TO_DOMAIN;
  attemptCount: number;
  nextAttemptAt: Date | null;
  claimedAt: Date | null;
  lastError: string | null;
  succeededAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export class PrismaEmailOutboxStorage implements EmailOutboxStorage {
  constructor(private readonly prisma: PrismaEmailOutboxModel) {}

  async append(record: AppendInput): Promise<void> {
    await this.prisma.emailOutbox.create({
      data: {
        id: record.id,
        kind: KIND_DOMAIN_TO_DB[record.kind],
        payload: record.payload as object,
        idempotencyKey: record.idempotencyKey,
        status: STATUS_DOMAIN_TO_DB[record.status],
        attemptCount: record.attemptCount,
        nextAttemptAt: record.nextAttemptAt,
        claimedAt: record.claimedAt,
        lastError: record.lastError,
        succeededAt: record.succeededAt,
        failedAt: record.failedAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      },
    });
  }

  async findByIdempotencyKey(key: string): Promise<EmailOutboxRecord | null> {
    const row = await this.prisma.emailOutbox.findUnique({
      where: { idempotencyKey: key },
    });
    return row ? toRecord(row as PrismaEmailOutboxRow) : null;
  }

  async listDispatchable(now: Date, limit: number): Promise<EmailOutboxRecord[]> {
    const staleBefore = new Date(now.getTime() - STALE_CLAIM_THRESHOLD_MS);
    const rows = await this.prisma.emailOutbox.findMany({
      where: {
        status: "PENDING",
        AND: [
          {
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
          },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit,
    });
    return (rows as PrismaEmailOutboxRow[]).map(toRecord);
  }

  async claim(id: string, claimedAt: Date): Promise<boolean> {
    // Atomic claim: only flip claimed_at when the row is pending and
    // either unclaimed or holds a stale claim. Returns the affected
    // row-count so concurrent workers see a `false` and skip.
    const staleBefore = new Date(claimedAt.getTime() - STALE_CLAIM_THRESHOLD_MS);
    const result = await this.prisma.emailOutbox.updateMany({
      where: {
        id,
        status: "PENDING",
        OR: [{ claimedAt: null }, { claimedAt: { lt: staleBefore } }],
      },
      data: { claimedAt },
    });
    return result.count > 0;
  }

  async markSent(id: string, at: Date): Promise<boolean> {
    const result = await this.prisma.emailOutbox.updateMany({
      where: { id },
      data: { status: "SENT", succeededAt: at, claimedAt: null },
    });
    return result.count > 0;
  }

  async markDeadLetter(id: string, at: Date, error: string): Promise<boolean> {
    const result = await this.prisma.emailOutbox.updateMany({
      where: { id },
      data: { status: "DEAD_LETTER", failedAt: at, lastError: error, claimedAt: null },
    });
    return result.count > 0;
  }

  async recordTransientFailure(
    id: string,
    attemptCount: number,
    nextAttemptAt: Date,
    error: string,
  ): Promise<boolean> {
    const result = await this.prisma.emailOutbox.updateMany({
      where: { id },
      data: { attemptCount, nextAttemptAt, lastError: error, claimedAt: null },
    });
    return result.count > 0;
  }

  async countPending(): Promise<number> {
    return this.prisma.emailOutbox.count({ where: { status: "PENDING" } });
  }

  async oldestPendingAge(now: Date): Promise<number> {
    const oldest = await this.prisma.emailOutbox.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    if (!oldest) return 0;
    return Math.max(0, now.getTime() - oldest.createdAt.getTime());
  }
}

function toRecord(row: PrismaEmailOutboxRow): EmailOutboxRecord {
  return {
    id: row.id,
    kind: KIND_DB_TO_DOMAIN[row.kind],
    payload: row.payload as EmailOutboxPayload,
    idempotencyKey: row.idempotencyKey,
    status: STATUS_DB_TO_DOMAIN[row.status],
    attemptCount: row.attemptCount,
    nextAttemptAt: row.nextAttemptAt,
    claimedAt: row.claimedAt,
    lastError: row.lastError,
    succeededAt: row.succeededAt,
    failedAt: row.failedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
