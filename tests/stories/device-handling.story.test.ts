import { describe, expect, it } from "vitest";

import {
  decideDeviceHandling,
  selectOldestSessionForRevoke,
  type KnownSession,
} from "../../src/core/devices/device-handling.js";

/**
 * Story · Device-handling decision planner.
 *
 * The planner takes the current sign-in's fingerprint plus the
 * user's existing sessions and decides what the runner should do:
 *
 *   - { action: "known" }                — fingerprint matches
 *     a previous session; no notification, no revoke.
 *   - { action: "new-device", revokeId } — fingerprint is new;
 *     notify the user, optionally revoke the oldest session if
 *     the cap is exceeded.
 *   - { action: "limit-block" }          — operator-configurable
 *     stricter mode where exceeding the cap blocks the new sign-in
 *     instead of revoking the oldest. (Out of scope today, but the
 *     planner already returns the right shape for callers to lean
 *     on later.)
 *
 * The planner is pure — no I/O, no Date, no rate limit. The runner
 * (\`device-handling.runner.ts\`) glues it to Prisma + outbox + revoke.
 */
describe("Story · device-handling planner", () => {
  const now = new Date("2026-04-30T10:00:00Z");

  function session(
    overrides: Partial<KnownSession> & { fp: string; lastSeenAt: string; id?: string },
  ): KnownSession {
    return {
      id: overrides.id ?? `s-${overrides.fp.slice(0, 6)}`,
      fingerprintHash: overrides.fp,
      lastSeenAt: new Date(overrides.lastSeenAt),
      createdAt: new Date(overrides.lastSeenAt),
    };
  }

  describe("decideDeviceHandling()", () => {
    it("returns 'known' when the fingerprint matches an existing session", () => {
      const known = [
        session({ fp: "fp-a", lastSeenAt: "2026-04-29T09:00:00Z" }),
        session({ fp: "fp-b", lastSeenAt: "2026-04-30T08:00:00Z" }),
      ];
      const result = decideDeviceHandling({
        currentFingerprint: "fp-a",
        currentSessionId: "current",
        knownSessions: known,
        maxDevicesPerUser: 10,
        now,
      });
      expect(result.action).toBe("known");
    });

    it("returns 'new-device' (no revoke) when the fingerprint is new and below the cap", () => {
      const known = [session({ fp: "fp-a", lastSeenAt: "2026-04-29T09:00:00Z" })];
      const result = decideDeviceHandling({
        currentFingerprint: "fp-new",
        currentSessionId: "current",
        knownSessions: known,
        maxDevicesPerUser: 10,
        now,
      });
      expect(result.action).toBe("new-device");
      if (result.action === "new-device") {
        expect(result.revokeSessionId).toBeUndefined();
      }
    });

    it("returns 'new-device' with revokeSessionId when adding would exceed the cap", () => {
      // 3 known sessions + 1 new = 4. Cap = 3 → revoke the oldest
      // existing session (NOT the current one) to keep the count
      // at the cap exactly.
      const known = [
        session({ fp: "fp-a", lastSeenAt: "2026-04-28T09:00:00Z", id: "old" }),
        session({ fp: "fp-b", lastSeenAt: "2026-04-29T09:00:00Z", id: "mid" }),
        session({ fp: "fp-c", lastSeenAt: "2026-04-30T08:00:00Z", id: "fresh" }),
      ];
      const result = decideDeviceHandling({
        currentFingerprint: "fp-new",
        currentSessionId: "current",
        knownSessions: known,
        maxDevicesPerUser: 3,
        now,
      });
      expect(result.action).toBe("new-device");
      if (result.action === "new-device") {
        expect(result.revokeSessionId).toBe("old");
      }
    });

    it("ignores the current session when checking for a fingerprint match", () => {
      // Better-Auth's session.create.after fires AFTER the row is
      // inserted, so the just-created session is part of
      // \`knownSessions\` if Prisma returns it. The planner must skip
      // it — otherwise every sign-in matches itself and looks
      // 'known'. Two sessions: one prior with a different fp, plus
      // the just-created current session that happens to match
      // itself. The match-check must skip the current id.
      const known = [
        session({ fp: "fp-prior", lastSeenAt: "2026-04-29T09:00:00Z", id: "prior" }),
        session({ fp: "fp-self", lastSeenAt: "2026-04-30T10:00:00Z", id: "current" }),
      ];
      const result = decideDeviceHandling({
        currentFingerprint: "fp-self",
        currentSessionId: "current",
        knownSessions: known,
        maxDevicesPerUser: 10,
        now,
      });
      // No PRIOR session shares the fingerprint → genuinely new.
      expect(result.action).toBe("new-device");
    });

    it("handles a zero-known-sessions case (first sign-in ever)", () => {
      // First-ever sign-in: no prior sessions. Spec is "no email
      // on the first session" so the planner returns 'first-sign-in'
      // — the runner skips notification but still records the fp.
      const result = decideDeviceHandling({
        currentFingerprint: "fp-x",
        currentSessionId: "current",
        knownSessions: [],
        maxDevicesPerUser: 10,
        now,
      });
      expect(result.action).toBe("first-sign-in");
    });
  });

  describe("selectOldestSessionForRevoke()", () => {
    it("picks the session with the smallest lastSeenAt", () => {
      const sessions = [
        session({ fp: "fp-a", lastSeenAt: "2026-04-30T09:00:00Z", id: "newer" }),
        session({ fp: "fp-b", lastSeenAt: "2026-04-29T09:00:00Z", id: "older" }),
        session({ fp: "fp-c", lastSeenAt: "2026-04-30T08:00:00Z", id: "middle" }),
      ];
      expect(selectOldestSessionForRevoke(sessions)).toBe("older");
    });

    it("falls back to createdAt when lastSeenAt ties", () => {
      const ts = "2026-04-30T08:00:00Z";
      const sessions: KnownSession[] = [
        {
          id: "newer-create",
          fingerprintHash: "fp-a",
          lastSeenAt: new Date(ts),
          createdAt: new Date("2026-04-30T07:00:00Z"),
        },
        {
          id: "older-create",
          fingerprintHash: "fp-b",
          lastSeenAt: new Date(ts),
          createdAt: new Date("2026-04-29T07:00:00Z"),
        },
      ];
      expect(selectOldestSessionForRevoke(sessions)).toBe("older-create");
    });

    it("returns null for an empty list", () => {
      expect(selectOldestSessionForRevoke([])).toBeNull();
    });
  });
});
