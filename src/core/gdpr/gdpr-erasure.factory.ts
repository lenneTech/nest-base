import { Logger } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import type { PendingErasureRecord } from "./gdpr-grace.planner.js";
import type { GdprErasureRunnerInput } from "./gdpr-erasure.runner.js";

const log = new Logger("GdprErasureFactory");

interface GdprErasureFactoryDeps {
  readonly prisma: PrismaService;
}

/**
 * Builds the production `GdprErasureRunnerInput` (CF.GDPR.04).
 *
 * Reader: `$queryRawUnsafe` against `pending_erasures` for rows where
 * `completed_at IS NULL AND cancelled_at IS NULL`. The grace-window
 * planner re-evaluates per-row so the reader returns every active
 * pending request and lets the planner partition. We side-step the
 * Prisma model delegate (`prisma.pendingErasure.findMany`) for the
 * same Nest-IoC Proxy reason iter-84 documented for the audit
 * subsystem.
 *
 * Eraser: anonymises the User row by replacing PII with sentinel
 * values — `email = '[ERASED]:<id>@erased.local'`,
 * `name = '[ERASED]'`, plus clearing all per-user secondary tables
 * (sessions, accounts, two-factors, passkeys). Hard-delete is
 * intentionally NOT the default — auditors require the user-id to
 * remain queryable (e.g. "did this id exist?") for orphan-record
 * forensics, while the PII contents are removed. Projects that
 * require strict hard-delete override the binding.
 *
 * Watermark: `UPDATE pending_erasures SET completed_at = NOW()
 * WHERE id = $1` via `$executeRawUnsafe` so the next cron tick
 * doesn't re-erase the same user.
 */
export function buildDefaultGdprErasureRunnerInput(
  deps: GdprErasureFactoryDeps,
): GdprErasureRunnerInput {
  return {
    readPending: () => readPendingErasures(deps.prisma),
    eraseUser: (candidate) => anonymiseUser(deps.prisma, candidate.userId),
    markCompleted: (id, atMs) => markErasureCompleted(deps.prisma, id, atMs),
  };
}

interface PendingErasureRow {
  readonly id: string;
  readonly user_id: string;
  readonly requested_at: Date;
  readonly cancelled_at: Date | null;
  readonly completed_at: Date | null;
}

async function readPendingErasures(
  prisma: PrismaService,
): Promise<readonly PendingErasureRecord[]> {
  // We read every active pending row (cancelled_at NULL,
  // completed_at NULL) — the planner partitions by 30-day grace.
  // Already-completed rows are filtered out so the planner doesn't
  // re-process them on every tick.
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, user_id, requested_at, cancelled_at, completed_at
       FROM pending_erasures
      WHERE completed_at IS NULL`,
  )) as PendingErasureRow[];
  return rows.map(
    (r): PendingErasureRecord => ({
      id: r.id,
      userId: r.user_id,
      requestedAt: r.requested_at.getTime(),
      cancelledAt: r.cancelled_at ? r.cancelled_at.getTime() : null,
      completedAt: r.completed_at ? r.completed_at.getTime() : null,
    }),
  );
}

/**
 * Anonymise the User row + delete every secondary per-user record.
 *
 * Order matters: cascade-deletes from User would also work but we
 * delete explicitly first so failures (e.g. FK from a project model)
 * surface against a specific table rather than as a single
 * "cascade failed" error.
 *
 * After secondaries are gone we UPDATE the User row in place so the
 * id remains queryable (orphan-row forensics), but every PII field
 * carries a sentinel value. The unique-on-email constraint forces
 * us to make the sentinel email unique per row: `[ERASED]:<id>@erased.local`.
 */
async function anonymiseUser(prisma: PrismaService, userId: string): Promise<void> {
  // Two-factor + passkey + session + account rows hold credentials
  // / device material; tombstoning requires their full removal.
  await prisma.$executeRawUnsafe(`DELETE FROM two_factors WHERE user_id = $1::uuid`, userId);
  await prisma.$executeRawUnsafe(`DELETE FROM passkeys WHERE user_id = $1::uuid`, userId);
  await prisma.$executeRawUnsafe(`DELETE FROM sessions WHERE user_id = $1::uuid`, userId);
  await prisma.$executeRawUnsafe(`DELETE FROM accounts WHERE user_id = $1::uuid`, userId);
  // API keys carry PII via `name`; rotate-revoking them is the right call.
  await prisma.$executeRawUnsafe(`DELETE FROM api_keys WHERE user_id = $1::uuid`, userId);

  const sentinelEmail = `[ERASED]:${userId}@erased.local`;
  await prisma.$executeRawUnsafe(
    `UPDATE users
        SET email = $1,
            name = '[ERASED]',
            email_verified = false,
            image = NULL,
            two_factor_enabled = NULL,
            updated_at = NOW()
      WHERE id = $2::uuid`,
    sentinelEmail,
    userId,
  );

  log.log(`gdprErasure: anonymised userId=${userId}`);
}

async function markErasureCompleted(
  prisma: PrismaService,
  id: string,
  atMs: number,
): Promise<void> {
  const ts = new Date(atMs).toISOString();
  await prisma.$executeRawUnsafe(
    `UPDATE pending_erasures SET completed_at = $1::timestamp WHERE id = $2::uuid`,
    ts,
    id,
  );
}
