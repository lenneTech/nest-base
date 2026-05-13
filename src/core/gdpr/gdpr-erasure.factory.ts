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
 *
 * Atomicity: `eraseUser` + `markCompleted` are intentionally kept
 * as separate closures so the runner can control the transaction
 * boundary. The factory wraps both inside a single Prisma transaction
 * to guarantee all-or-nothing semantics — a crash between anonymise
 * and watermark no longer leaves a half-erased user (CRIT-1).
 */
export function buildDefaultGdprErasureRunnerInput(
  deps: GdprErasureFactoryDeps,
): GdprErasureRunnerInput {
  return {
    readPending: () => readPendingErasures(deps.prisma),
    eraseUser: (candidate) =>
      // Wrap the full erasure (anonymise + watermark) in one transaction so
      // a crash mid-way cannot leave PII partially removed or the completed_at
      // watermark unset. Either both commits or neither does.
      deps.prisma.$transaction(async (tx) => {
        await anonymiseUserInTx(tx, candidate.userId);
        await markErasureCompletedInTx(tx, candidate.id, Date.now());
      }),
    // markCompleted is kept for interface compatibility but the real work
    // happens inside the transaction in eraseUser above. The runner still
    // calls markCompleted; we make it a no-op here because the transaction
    // already wrote the watermark.
    markCompleted: async (_id, _atMs) => {
      // Intentional no-op: watermark is written inside the eraseUser
      // transaction (CRIT-1). Keeping the signature satisfies the
      // GdprErasureRunnerInput interface without a breaking change.
    },
  };
}

interface PendingErasureRow {
  readonly id: string;
  readonly user_id: string;
  readonly requested_at: Date;
  readonly cancelled_at: Date | null;
  readonly completed_at: Date | null;
}

// Minimal subset of the Prisma transaction client used inside the
// erasure transaction — typed narrowly so we don't depend on generated
// model delegates that require `prisma:generate` output.
interface ErasureTx {
  $executeRawUnsafe(sql: string, ...args: unknown[]): Promise<number>;
}

async function readPendingErasures(
  prisma: PrismaService,
): Promise<readonly PendingErasureRecord[]> {
  // Read active pending rows: completed_at IS NULL AND cancelled_at IS NULL
  // (CRIT-2: excluded cancelled rows so they don't re-enter the dispatch path).
  // LIMIT 500 prevents unbounded reads when erasure jobs accumulate (NIT-2).
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, user_id, requested_at, cancelled_at, completed_at
       FROM pending_erasures
      WHERE completed_at IS NULL
        AND cancelled_at IS NULL
      LIMIT 500`,
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
 * Runs inside the caller's Prisma transaction (CRIT-1). All
 * statements use `tx.$executeRawUnsafe` so the writes participate
 * in the same atomic unit as the `completed_at` watermark write.
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
async function anonymiseUserInTx(tx: ErasureTx, userId: string): Promise<void> {
  // Two-factor + passkey + session + account rows hold credentials
  // / device material; tombstoning requires their full removal.
  await tx.$executeRawUnsafe(`DELETE FROM two_factors WHERE user_id = $1::uuid`, userId);
  await tx.$executeRawUnsafe(`DELETE FROM passkeys WHERE user_id = $1::uuid`, userId);
  await tx.$executeRawUnsafe(`DELETE FROM sessions WHERE user_id = $1::uuid`, userId);
  await tx.$executeRawUnsafe(`DELETE FROM accounts WHERE user_id = $1::uuid`, userId);
  // API keys carry PII via `name`; rotate-revoking them is the right call.
  await tx.$executeRawUnsafe(`DELETE FROM api_keys WHERE user_id = $1::uuid`, userId);

  const sentinelEmail = `[ERASED]:${userId}@erased.local`;
  await tx.$executeRawUnsafe(
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

async function markErasureCompletedInTx(tx: ErasureTx, id: string, atMs: number): Promise<void> {
  const ts = new Date(atMs).toISOString();
  await tx.$executeRawUnsafe(
    `UPDATE pending_erasures SET completed_at = $1::timestamp WHERE id = $2::uuid`,
    ts,
    id,
  );
}
