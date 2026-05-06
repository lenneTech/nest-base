/**
 * Sessions admin revoke planner (CF.AUTH.21 + CF.AUTH.22).
 *
 * Pure planner that selects sessions for termination given a revoke
 * strategy. The runner (the admin pane controller wired against
 * Better-Auth's session adapter) iterates the planner's output and
 * deletes each session.
 *
 * Why a planner: the selection logic for "revoke single" vs
 * "bulk-by-user" vs "bulk-by-user-except-current" is the part that
 * can have subtle bugs (off-by-one on `except-current`, accidental
 * cross-user revoke, etc.). Keeping it as a pure function makes
 * every variant trivial to test against fixtures.
 *
 * Strategies:
 *   - `single` — exactly one session by id.
 *   - `bulk-by-user` — every session for the user.
 *   - `bulk-by-user-except-current` — every session for the user
 *     EXCEPT the one currently in use (so the actor doesn't kick
 *     themselves off when clicking "log me out everywhere else").
 */

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: number;
}

export type SessionRevokeStrategy =
  | { readonly kind: "single"; readonly sessionId: string }
  | { readonly kind: "bulk-by-user"; readonly userId: string }
  | {
      readonly kind: "bulk-by-user-except-current";
      readonly userId: string;
      readonly currentSessionId: string;
    };

export interface SessionRevokeInput {
  readonly sessions: readonly SessionRecord[];
  readonly strategy: SessionRevokeStrategy;
}

export interface SessionRevokePlan {
  readonly sessionIds: readonly string[];
}

export function planSessionRevoke(input: SessionRevokeInput): SessionRevokePlan {
  const { sessions, strategy } = input;

  if (strategy.kind === "single") {
    const target = sessions.find((s) => s.id === strategy.sessionId);
    return { sessionIds: target ? [target.id] : [] };
  }

  if (strategy.kind === "bulk-by-user") {
    const ids = sessions.filter((s) => s.userId === strategy.userId).map((s) => s.id);
    return { sessionIds: ids };
  }

  // bulk-by-user-except-current
  const ids = sessions
    .filter((s) => s.userId === strategy.userId)
    .filter((s) => s.id !== strategy.currentSessionId)
    .map((s) => s.id);
  return { sessionIds: ids };
}
