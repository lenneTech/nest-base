import { describe, expect, it } from "vitest";

/**
 * Story · Email-outbox chaos: kill worker mid-dispatch, restart,
 * exactly-once delivery (SC.SUB.09).
 *
 * The PRD's `SC.SUB.09` requires the at-least-once email outbox to
 * survive a worker crash without dropping mail and without
 * delivering twice for the same idempotency-key.
 *
 * Scenario modelled here:
 *   1. Worker A claims a pending record (sets `claimedAt = now`).
 *   2. Worker A crashes BEFORE dispatching (process killed, deploy
 *      rolled, container OOM-killed).
 *   3. The claim sits live for less than `STALE_CLAIM_THRESHOLD_MS`
 *      (30s). A new worker B that ticks during this window MUST NOT
 *      double-claim — `shouldDispatchNow` returns false.
 *   4. Wall-clock advances past the staleness threshold. Worker B
 *      ticks again — the planner now considers the claim stale and
 *      lets B steal it. Exactly one dispatch happens.
 *   5. Idempotency is preserved at the recorder layer (per the
 *      EmailOutboxRecorder contract): a record is never re-enqueued
 *      twice for the same idempotency-key.
 *
 * The test exercises the pure planner contract; the production
 * worker (`EmailOutboxWorker`) wraps `shouldDispatchNow` /
 * `isStaleClaim` / `planEmailRetry` in the dispatch loop.
 */
describe("Story · Email-outbox chaos (SC.SUB.09)", () => {
  describe("Worker A claims, A crashes, B ticks before staleness threshold", () => {
    it("blocks B from re-claiming while the claim is still fresh", async () => {
      const { shouldDispatchNow } = await import("../../src/core/email/email-outbox-planner.js");
      const claimedAt = new Date(1_000_000);
      const tickAt = new Date(1_000_000 + 5_000); // 5s after claim
      // Status is still pending — A never finished — but the claim is fresh.
      expect(
        shouldDispatchNow({
          status: "pending",
          nextAttemptAt: null,
          claimedAt,
          now: tickAt,
        }),
      ).toBe(false);
    });

    it("permits B to steal once the claim ages past the staleness threshold", async () => {
      const { shouldDispatchNow, STALE_CLAIM_THRESHOLD_MS } =
        await import("../../src/core/email/email-outbox-planner.js");
      const claimedAt = new Date(1_000_000);
      const tickAt = new Date(claimedAt.getTime() + STALE_CLAIM_THRESHOLD_MS + 1);
      expect(
        shouldDispatchNow({
          status: "pending",
          nextAttemptAt: null,
          claimedAt,
          now: tickAt,
        }),
      ).toBe(true);
    });
  });

  describe("Worker A succeeds — record never re-dispatches", () => {
    it("never picks up a record in terminal status (sent)", async () => {
      const { shouldDispatchNow } = await import("../../src/core/email/email-outbox-planner.js");
      expect(
        shouldDispatchNow({
          status: "sent",
          nextAttemptAt: null,
          claimedAt: null,
          now: new Date(),
        }),
      ).toBe(false);
    });

    it("never picks up a record in terminal status (dead-letter)", async () => {
      const { shouldDispatchNow } = await import("../../src/core/email/email-outbox-planner.js");
      expect(
        shouldDispatchNow({
          status: "dead-letter",
          nextAttemptAt: null,
          claimedAt: null,
          now: new Date(),
        }),
      ).toBe(false);
    });
  });

  describe("Retry policy after worker crash + recovery", () => {
    it("schedules the next attempt with the configured backoff", async () => {
      const { planEmailRetry, DEFAULT_EMAIL_OUTBOX_RETRY } =
        await import("../../src/core/email/email-outbox-planner.js");
      const now = new Date(1_000_000);
      const result = planEmailRetry({
        attemptCount: 1,
        errorKind: "transient",
        now,
        config: DEFAULT_EMAIL_OUTBOX_RETRY,
      });
      expect(result.terminal).toBe(false);
      // initialDelayMs = 60_000 → next attempt at 1m
      expect(result.nextAttemptAt?.getTime()).toBe(1_060_000);
    });

    it("graduates to dead-letter after the maxAttempts ceiling", async () => {
      const { planEmailRetry, DEFAULT_EMAIL_OUTBOX_RETRY } =
        await import("../../src/core/email/email-outbox-planner.js");
      const result = planEmailRetry({
        attemptCount: DEFAULT_EMAIL_OUTBOX_RETRY.maxAttempts,
        errorKind: "transient",
        now: new Date(),
        config: DEFAULT_EMAIL_OUTBOX_RETRY,
      });
      expect(result.terminal).toBe(true);
      expect(result.nextAttemptAt).toBeUndefined();
    });

    it("permanent errors short-circuit to dead-letter (no retry)", async () => {
      const { planEmailRetry, DEFAULT_EMAIL_OUTBOX_RETRY } =
        await import("../../src/core/email/email-outbox-planner.js");
      const result = planEmailRetry({
        attemptCount: 1,
        errorKind: "permanent",
        now: new Date(),
        config: DEFAULT_EMAIL_OUTBOX_RETRY,
      });
      expect(result.terminal).toBe(true);
    });
  });

  describe("End-to-end chaos scenario simulation", () => {
    it("worker-A-crash → worker-B-recovery results in exactly-one logical dispatch", async () => {
      const { shouldDispatchNow, isStaleClaim, STALE_CLAIM_THRESHOLD_MS } =
        await import("../../src/core/email/email-outbox-planner.js");

      // T+0 : record ingested (pending, no claim)
      let recordState = {
        status: "pending" as const,
        nextAttemptAt: null as Date | null,
        claimedAt: null as Date | null,
      };
      const t0 = new Date(1_000_000);
      expect(shouldDispatchNow({ ...recordState, now: t0 })).toBe(true);

      // T+0 : Worker A claims
      recordState = { ...recordState, claimedAt: t0 };

      // T+5s : Worker B ticks. Claim still fresh — must skip.
      const t5s = new Date(t0.getTime() + 5_000);
      expect(isStaleClaim(recordState.claimedAt, t5s)).toBe(false);
      expect(shouldDispatchNow({ ...recordState, now: t5s })).toBe(false);

      // T+(threshold + 1ms) : Worker B ticks. Claim is now stale → steal.
      const tStale = new Date(t0.getTime() + STALE_CLAIM_THRESHOLD_MS + 1);
      expect(isStaleClaim(recordState.claimedAt, tStale)).toBe(true);
      expect(shouldDispatchNow({ ...recordState, now: tStale })).toBe(true);

      // Worker B claims + dispatches successfully → status: sent
      recordState = { ...recordState, status: "pending" }; // worker is now dispatching
      const sentState = { ...recordState, status: "sent" as const };
      expect(shouldDispatchNow({ ...sentState, now: new Date() })).toBe(false);
    });
  });
});
