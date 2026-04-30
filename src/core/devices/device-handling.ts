/**
 * Device-handling decision planner.
 *
 * Pure function: given the current sign-in's fingerprint plus the
 * user's existing sessions, decide what the runner should do
 * (notify? revoke an old session?). No I/O, no Date construction,
 * no rate-limiter — those live in the runner.
 *
 * Output union:
 *   - `first-sign-in` — no prior sessions; record the fingerprint
 *     but skip the notification (a brand-new account shouldn't get
 *     a "new device" email about its very first session).
 *   - `known`         — fingerprint matches a previous session;
 *     the runner only refreshes `lastSeenAt`.
 *   - `new-device`    — fingerprint is new; the runner enqueues
 *     the new-device email and (if `revokeSessionId` is set) deletes
 *     the oldest existing session to honour the per-user cap.
 *
 * The cap is "≤ maxDevicesPerUser AFTER the current sign-in":
 * given N existing sessions and the just-created one, that totals
 * N+1. When N+1 > cap, revoke the oldest existing.
 */

export interface KnownSession {
  /** Better-Auth session row id. */
  id: string;
  /** sha256 hex from `fingerprintSession()`; null when never recorded. */
  fingerprintHash: string;
  lastSeenAt: Date;
  createdAt: Date;
}

export interface DeviceHandlingDecisionInput {
  currentFingerprint: string;
  /**
   * id of the just-created session — Better-Auth's
   * `session.create.after` hook fires after Prisma inserted it, so
   * the row is already in `knownSessions`. The planner skips it
   * when looking for "have we seen this fingerprint before".
   */
  currentSessionId: string;
  knownSessions: KnownSession[];
  maxDevicesPerUser: number;
  /** Carried for forward-compat (e.g. impossible-travel scoring). */
  now: Date;
}

export type DeviceHandlingDecision =
  | { action: "first-sign-in" }
  | { action: "known" }
  | { action: "new-device"; revokeSessionId?: string };

export function decideDeviceHandling(input: DeviceHandlingDecisionInput): DeviceHandlingDecision {
  const others = input.knownSessions.filter((s) => s.id !== input.currentSessionId);

  if (others.length === 0) {
    // First-ever sign-in for this user — record the fingerprint but
    // don't email; there's no prior context to compare against.
    return { action: "first-sign-in" };
  }

  const matched = others.some((s) => s.fingerprintHash === input.currentFingerprint);
  if (matched) return { action: "known" };

  // New device. With the just-created session counted, the user
  // would now have `others.length + 1` sessions. When that exceeds
  // the cap, revoke the oldest existing session (NOT the current
  // one — that would defeat the point of just signing in).
  const totalAfter = others.length + 1;
  if (totalAfter > input.maxDevicesPerUser) {
    const oldestId = selectOldestSessionForRevoke(others);
    return oldestId !== null
      ? { action: "new-device", revokeSessionId: oldestId }
      : { action: "new-device" };
  }
  return { action: "new-device" };
}

/**
 * Returns the session id with the smallest `lastSeenAt`
 * (ties broken by `createdAt`), or `null` when the list is empty.
 *
 * Pulled out so the runner can call it directly when revoking
 * mid-flight (e.g. an admin force-revokes when the user adds a
 * 6th device with cap=5 in the dev-portal).
 */
export function selectOldestSessionForRevoke(sessions: KnownSession[]): string | null {
  if (sessions.length === 0) return null;
  let oldest = sessions[0]!;
  for (const candidate of sessions.slice(1)) {
    if (candidate.lastSeenAt < oldest.lastSeenAt) {
      oldest = candidate;
      continue;
    }
    if (
      candidate.lastSeenAt.getTime() === oldest.lastSeenAt.getTime() &&
      candidate.createdAt < oldest.createdAt
    ) {
      oldest = candidate;
    }
  }
  return oldest.id;
}
