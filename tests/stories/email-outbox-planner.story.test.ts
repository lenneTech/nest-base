import { describe, expect, it } from "vitest";

import {
  DEFAULT_EMAIL_OUTBOX_RETRY,
  STALE_CLAIM_THRESHOLD_MS,
  isStaleClaim,
  planEmailRetry,
  shouldDispatchNow,
} from "../../src/core/email/email-outbox-planner.js";

/**
 * Story · Email-Outbox planner.
 *
 * Pure functions used by `EmailOutboxWorker` and `EmailOutboxRecorder`:
 *
 *  - `planEmailRetry()`  computes next-attempt time / terminal state
 *    given current `attemptCount`, the (transient/permanent) error
 *    classification, and `now`.
 *  - `shouldDispatchNow()` decides whether a record is due for the
 *    current tick — pending status, no live claim, `nextAttemptAt`
 *    in the past.
 *  - `isStaleClaim()` flags claim-timestamps older than the
 *    crash-safety threshold so the worker can rescue them.
 *
 * Splitting the decisions out keeps the worker dispatch loop a thin
 * runner — the math is testable without DB or driver wiring.
 */
describe("Story · Email-Outbox planner", () => {
  const NOW = new Date("2026-04-30T12:00:00.000Z");

  describe("planEmailRetry()", () => {
    it("returns exponential delays following the configured factor", () => {
      const cfg = DEFAULT_EMAIL_OUTBOX_RETRY;
      const r1 = planEmailRetry({ attemptCount: 1, errorKind: "transient", now: NOW, config: cfg });
      const r2 = planEmailRetry({ attemptCount: 2, errorKind: "transient", now: NOW, config: cfg });
      const r3 = planEmailRetry({ attemptCount: 3, errorKind: "transient", now: NOW, config: cfg });

      expect(r1.terminal).toBe(false);
      expect(r2.terminal).toBe(false);
      expect(r3.terminal).toBe(false);

      // Each subsequent retry waits longer than the previous one.
      const d1 = r1.nextAttemptAt!.getTime() - NOW.getTime();
      const d2 = r2.nextAttemptAt!.getTime() - NOW.getTime();
      const d3 = r3.nextAttemptAt!.getTime() - NOW.getTime();
      expect(d2).toBeGreaterThan(d1);
      expect(d3).toBeGreaterThan(d2);

      // Configured factor ⇒ each delay is `factor x` the previous.
      expect(d2).toBe(d1 * cfg.factor);
      expect(d3).toBe(d2 * cfg.factor);
    });

    it("caps the delay at maxDelayMs", () => {
      const cfg = { ...DEFAULT_EMAIL_OUTBOX_RETRY, maxDelayMs: 60_000, maxAttempts: 100 };
      const r = planEmailRetry({ attemptCount: 50, errorKind: "transient", now: NOW, config: cfg });
      expect(r.terminal).toBe(false);
      const delta = r.nextAttemptAt!.getTime() - NOW.getTime();
      expect(delta).toBeLessThanOrEqual(60_000);
    });

    it("marks the record terminal once attemptCount reaches maxAttempts", () => {
      const cfg = DEFAULT_EMAIL_OUTBOX_RETRY;
      const r = planEmailRetry({
        attemptCount: cfg.maxAttempts,
        errorKind: "transient",
        now: NOW,
        config: cfg,
      });
      expect(r.terminal).toBe(true);
      expect(r.nextAttemptAt).toBeUndefined();
    });

    it("treats permanent errors as terminal on the first attempt", () => {
      const cfg = DEFAULT_EMAIL_OUTBOX_RETRY;
      const r = planEmailRetry({ attemptCount: 1, errorKind: "permanent", now: NOW, config: cfg });
      expect(r.terminal).toBe(true);
      expect(r.nextAttemptAt).toBeUndefined();
    });

    it("rejects non-positive attempt counts", () => {
      const cfg = DEFAULT_EMAIL_OUTBOX_RETRY;
      expect(() =>
        planEmailRetry({ attemptCount: 0, errorKind: "transient", now: NOW, config: cfg }),
      ).toThrow(/attempt/i);
    });
  });

  describe("shouldDispatchNow()", () => {
    it("returns true for pending records whose nextAttemptAt is in the past", () => {
      expect(
        shouldDispatchNow({
          status: "pending",
          nextAttemptAt: new Date(NOW.getTime() - 1000),
          claimedAt: null,
          now: NOW,
        }),
      ).toBe(true);
    });

    it("returns true for pending records with null nextAttemptAt (first try)", () => {
      expect(
        shouldDispatchNow({
          status: "pending",
          nextAttemptAt: null,
          claimedAt: null,
          now: NOW,
        }),
      ).toBe(true);
    });

    it("returns false when nextAttemptAt is still in the future", () => {
      expect(
        shouldDispatchNow({
          status: "pending",
          nextAttemptAt: new Date(NOW.getTime() + 60_000),
          claimedAt: null,
          now: NOW,
        }),
      ).toBe(false);
    });

    it("returns false for terminal statuses", () => {
      for (const status of ["sent", "dead-letter"] as const) {
        expect(
          shouldDispatchNow({
            status,
            nextAttemptAt: new Date(NOW.getTime() - 60_000),
            claimedAt: null,
            now: NOW,
          }),
        ).toBe(false);
      }
    });

    it("returns false when a fresh claim exists (someone else is sending)", () => {
      expect(
        shouldDispatchNow({
          status: "pending",
          nextAttemptAt: null,
          claimedAt: new Date(NOW.getTime() - 1000), // 1s ago — fresh
          now: NOW,
        }),
      ).toBe(false);
    });

    it("returns true when the claim is stale (worker probably crashed)", () => {
      expect(
        shouldDispatchNow({
          status: "pending",
          nextAttemptAt: null,
          claimedAt: new Date(NOW.getTime() - STALE_CLAIM_THRESHOLD_MS - 1),
          now: NOW,
        }),
      ).toBe(true);
    });
  });

  describe("isStaleClaim()", () => {
    it("returns false for fresh claims", () => {
      expect(isStaleClaim(new Date(NOW.getTime() - 1000), NOW)).toBe(false);
    });
    it("returns true for claims older than the threshold", () => {
      expect(isStaleClaim(new Date(NOW.getTime() - STALE_CLAIM_THRESHOLD_MS - 1), NOW)).toBe(true);
    });
    it("returns false for null", () => {
      expect(isStaleClaim(null, NOW)).toBe(false);
    });
  });
});
