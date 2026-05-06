/**
 * GDPR grace-period planner — pure function (CF.GDPR.04).
 *
 * The PRD pins a 30-day grace period between a user requesting
 * account erasure (`DELETE /me/account`) and the actual erasure
 * landing. The planner takes the list of pending-deletion records
 * + the current clock + the grace window length, and returns the
 * subset whose grace window has elapsed.
 *
 * Why a planner: keeps the policy testable without Postgres + the
 * erasure runner. The runner (a scheduled job using `@ScheduledJob`)
 * walks the planner's output, executes the erasure, and clears the
 * pending-deletion row.
 *
 * What the planner does NOT decide:
 *   - The actual erasure mechanism (hard-delete vs anonymise) —
 *     that's the runner's call (typically reads project policy).
 *   - The user's permission to request deletion — that's gated by
 *     the `delete:User` ability at the controller layer.
 *
 * Default grace window: 30 days (PRD-mandated). Projects can shrink
 * it via `gracePeriodMs` for staging environments.
 */

export interface PendingErasureRecord {
  /** Stable id of the erasure-request row. */
  readonly id: string;
  /** User id whose data is being erased. */
  readonly userId: string;
  /** Wall-clock ms epoch the user requested erasure. */
  readonly requestedAt: number;
  /** Wall-clock ms epoch the user cancelled (when applicable). null = active. */
  readonly cancelledAt?: number | null;
  /** Wall-clock ms epoch the runner completed erasure. null = not yet run. */
  readonly completedAt?: number | null;
}

export interface GracePlanInput {
  readonly pending: readonly PendingErasureRecord[];
  /** Grace window length in ms. Defaults to 30 days. */
  readonly gracePeriodMs?: number;
  /** Injectable clock for deterministic tests. */
  readonly clock?: () => number;
}

export interface GraceErasureCandidate {
  readonly id: string;
  readonly userId: string;
  readonly requestedAt: number;
  readonly graceExpiredAt: number;
}

export interface GracePlanOutput {
  /** Records whose grace window has elapsed and the runner should erase. */
  readonly readyForErasure: readonly GraceErasureCandidate[];
  /** Records still inside the grace window — the runner skips them this tick. */
  readonly stillInGrace: readonly PendingErasureRecord[];
  /** Records cancelled / already erased — the runner ignores. */
  readonly skipped: readonly PendingErasureRecord[];
}

const DEFAULT_GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export function planGdprGracePeriodErasures(input: GracePlanInput): GracePlanOutput {
  const grace = input.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  if (grace < 0) {
    throw new Error(`gdpr-grace: gracePeriodMs must be non-negative (received: ${grace})`);
  }
  const now = (input.clock ?? Date.now)();

  const readyForErasure: GraceErasureCandidate[] = [];
  const stillInGrace: PendingErasureRecord[] = [];
  const skipped: PendingErasureRecord[] = [];

  for (const record of input.pending) {
    if (record.cancelledAt != null || record.completedAt != null) {
      skipped.push(record);
      continue;
    }
    const graceExpiredAt = record.requestedAt + grace;
    if (now >= graceExpiredAt) {
      readyForErasure.push({
        id: record.id,
        userId: record.userId,
        requestedAt: record.requestedAt,
        graceExpiredAt,
      });
    } else {
      stillInGrace.push(record);
    }
  }

  return { readyForErasure, stillInGrace, skipped };
}
