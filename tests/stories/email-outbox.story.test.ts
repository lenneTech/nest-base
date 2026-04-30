import { beforeEach, describe, expect, it } from "vitest";

import {
  EmailOutboxRecorder,
  EmailOutboxWorker,
  type EmailOutboxDriver,
  type EmailOutboxRecord,
  type EmailOutboxStorage,
} from "../../src/core/email/email-outbox.js";
import { DEFAULT_EMAIL_OUTBOX_RETRY } from "../../src/core/email/email-outbox-planner.js";

/**
 * Story · Email-Outbox recorder + worker.
 *
 * Recorder writes pending records (with optional idempotency-key
 * dedup); worker claims due records, dispatches to a driver, and
 * transitions them to `sent` / `dead-letter`. Failures fall back into
 * `pending` with `nextAttemptAt` shifted by the backoff planner.
 */
describe("Story · Email-Outbox", () => {
  function makeStorage(): EmailOutboxStorage & { records: EmailOutboxRecord[] } {
    const records: EmailOutboxRecord[] = [];
    return {
      get records() {
        return records;
      },
      async append(record) {
        records.push({ ...record });
      },
      async findByIdempotencyKey(key) {
        return records.find((r) => r.idempotencyKey === key) ?? null;
      },
      async listDispatchable(now, limit) {
        return records
          .filter((r) => {
            if (r.status !== "pending") return false;
            // Skip live claims (fresh claimedAt within stale-window)
            if (r.claimedAt) {
              const ageMs = now.getTime() - r.claimedAt.getTime();
              if (ageMs <= 30_000) return false;
            }
            if (r.nextAttemptAt && r.nextAttemptAt.getTime() > now.getTime()) return false;
            return true;
          })
          .slice(0, limit)
          .map((r) => ({ ...r }));
      },
      async claim(id, claimedAt) {
        const r = records.find((rec) => rec.id === id);
        if (!r) return false;
        if (r.status !== "pending") return false;
        if (r.claimedAt) {
          const ageMs = claimedAt.getTime() - r.claimedAt.getTime();
          if (ageMs <= 30_000) return false;
        }
        r.claimedAt = claimedAt;
        return true;
      },
      async markSent(id, at) {
        const r = records.find((rec) => rec.id === id);
        if (!r) return false;
        r.status = "sent";
        r.succeededAt = at;
        r.claimedAt = null;
        return true;
      },
      async markDeadLetter(id, at, error) {
        const r = records.find((rec) => rec.id === id);
        if (!r) return false;
        r.status = "dead-letter";
        r.failedAt = at;
        r.lastError = error;
        r.claimedAt = null;
        return true;
      },
      async recordTransientFailure(id, attemptCount, nextAttemptAt, error) {
        const r = records.find((rec) => rec.id === id);
        if (!r) return false;
        r.attemptCount = attemptCount;
        r.nextAttemptAt = nextAttemptAt;
        r.lastError = error;
        r.claimedAt = null;
        return true;
      },
      async countPending() {
        return records.filter((r) => r.status === "pending").length;
      },
      async oldestPendingAge(now) {
        const pending = records.filter((r) => r.status === "pending");
        if (pending.length === 0) return 0;
        const oldest = pending.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
        return Math.max(0, now.getTime() - oldest.createdAt.getTime());
      },
    };
  }

  function fakeDriver(opts?: {
    failKind?: "transient" | "permanent";
    failTimes?: number;
  }): EmailOutboxDriver & { calls: number } {
    let calls = 0;
    const failTimes = opts?.failTimes ?? 0;
    return {
      get calls() {
        return calls;
      },
      async dispatch(_record) {
        calls++;
        if (calls <= failTimes) {
          const err = new Error(`fail #${calls}`);
          (err as { kind?: string }).kind = opts?.failKind ?? "transient";
          throw err;
        }
        return { messageId: `msg-${calls}`, driver: "fake" };
      },
    };
  }

  let now: Date;
  beforeEach(() => {
    now = new Date("2026-04-30T12:00:00.000Z");
  });

  describe("EmailOutboxRecorder", () => {
    it("appends a pending record with the supplied payload", async () => {
      const storage = makeStorage();
      const rec = new EmailOutboxRecorder({ storage, now: () => now });
      const entry = await rec.enqueue({
        kind: "send",
        payload: { to: "user@example.com", subject: "Hi", html: "<b>hi</b>" },
      });
      expect(entry.id).toBeDefined();
      expect(entry.status).toBe("pending");
      expect(entry.attemptCount).toBe(0);
      expect(entry.kind).toBe("send");
      expect(storage.records).toHaveLength(1);
    });

    it("dedupes by idempotencyKey — second enqueue returns the first record", async () => {
      const storage = makeStorage();
      const rec = new EmailOutboxRecorder({ storage, now: () => now });
      const a = await rec.enqueue({
        kind: "send",
        idempotencyKey: "reset:user@example.com:abc",
        payload: { to: "user@example.com", subject: "Reset", html: "<a>x</a>" },
      });
      const b = await rec.enqueue({
        kind: "send",
        idempotencyKey: "reset:user@example.com:abc",
        payload: { to: "user@example.com", subject: "Reset (dup)", html: "<a>y</a>" },
      });
      expect(b.id).toBe(a.id);
      expect(storage.records).toHaveLength(1);
    });

    it("supports send-template payloads", async () => {
      const storage = makeStorage();
      const rec = new EmailOutboxRecorder({ storage, now: () => now });
      const entry = await rec.enqueue({
        kind: "sendTemplate",
        payload: {
          to: "user@example.com",
          template: "password-reset",
          vars: { resetUrl: "https://x" },
        },
      });
      expect(entry.kind).toBe("sendTemplate");
      expect(storage.records[0]!.kind).toBe("sendTemplate");
    });
  });

  describe("EmailOutboxWorker", () => {
    it("runOnce() dispatches a pending record and marks it sent", async () => {
      const storage = makeStorage();
      const recorder = new EmailOutboxRecorder({ storage, now: () => now });
      await recorder.enqueue({
        kind: "send",
        payload: { to: "user@example.com", subject: "Hi", html: "<b>hi</b>" },
      });

      const driver = fakeDriver();
      const worker = new EmailOutboxWorker({
        storage,
        driver,
        now: () => now,
        retry: DEFAULT_EMAIL_OUTBOX_RETRY,
        batchSize: 10,
      });
      const result = await worker.runOnce();
      expect(result.sent).toBe(1);
      expect(result.deadLetter).toBe(0);
      expect(result.retry).toBe(0);
      expect(driver.calls).toBe(1);
      expect(storage.records[0]!.status).toBe("sent");
      expect(storage.records[0]!.succeededAt).toBeInstanceOf(Date);
    });

    it("retries a transient failure with backoff and eventually succeeds", async () => {
      const storage = makeStorage();
      const recorder = new EmailOutboxRecorder({ storage, now: () => now });
      await recorder.enqueue({
        kind: "send",
        payload: { to: "user@example.com", subject: "Hi", html: "<b>hi</b>" },
      });

      const driver = fakeDriver({ failKind: "transient", failTimes: 1 });
      const worker = new EmailOutboxWorker({
        storage,
        driver,
        now: () => now,
        retry: DEFAULT_EMAIL_OUTBOX_RETRY,
        batchSize: 10,
      });

      const r1 = await worker.runOnce();
      expect(r1.retry).toBe(1);
      expect(storage.records[0]!.status).toBe("pending");
      expect(storage.records[0]!.attemptCount).toBe(1);
      expect(storage.records[0]!.nextAttemptAt!.getTime()).toBeGreaterThan(now.getTime());

      // Advance past the backoff window.
      now = new Date(storage.records[0]!.nextAttemptAt!.getTime() + 1);
      const r2 = await worker.runOnce();
      expect(r2.sent).toBe(1);
      expect(storage.records[0]!.status).toBe("sent");
    });

    it("escalates a permanent failure to dead-letter on first attempt", async () => {
      const storage = makeStorage();
      const recorder = new EmailOutboxRecorder({ storage, now: () => now });
      await recorder.enqueue({
        kind: "send",
        payload: { to: "user@example.com", subject: "Hi", html: "<b>hi</b>" },
      });

      const driver = fakeDriver({ failKind: "permanent", failTimes: 99 });
      const worker = new EmailOutboxWorker({
        storage,
        driver,
        now: () => now,
        retry: DEFAULT_EMAIL_OUTBOX_RETRY,
        batchSize: 10,
      });

      const result = await worker.runOnce();
      expect(result.deadLetter).toBe(1);
      expect(storage.records[0]!.status).toBe("dead-letter");
      expect(storage.records[0]!.lastError).toMatch(/fail/);
    });

    it("escalates to dead-letter when max attempts is reached", async () => {
      const storage = makeStorage();
      const recorder = new EmailOutboxRecorder({ storage, now: () => now });
      await recorder.enqueue({
        kind: "send",
        payload: { to: "user@example.com", subject: "Hi", html: "<b>hi</b>" },
      });

      // 2-attempt cap so we don't have to fast-forward five times.
      const cfg = { ...DEFAULT_EMAIL_OUTBOX_RETRY, maxAttempts: 2 };
      const driver = fakeDriver({ failKind: "transient", failTimes: 99 });
      const worker = new EmailOutboxWorker({
        storage,
        driver,
        now: () => now,
        retry: cfg,
        batchSize: 10,
      });

      // Attempt 1 → still retryable.
      const r1 = await worker.runOnce();
      expect(r1.retry).toBe(1);
      expect(storage.records[0]!.status).toBe("pending");

      // Advance past the backoff and run again — attempt 2 hits the
      // ceiling and the record is dead-lettered.
      now = new Date(storage.records[0]!.nextAttemptAt!.getTime() + 1);
      const r2 = await worker.runOnce();
      expect(r2.deadLetter).toBe(1);
      expect(storage.records[0]!.status).toBe("dead-letter");
    });

    it("runOnce() does not dispatch records whose nextAttemptAt is still in the future", async () => {
      const storage = makeStorage();
      const recorder = new EmailOutboxRecorder({ storage, now: () => now });
      await recorder.enqueue({
        kind: "send",
        payload: { to: "user@example.com", subject: "Hi", html: "<b>hi</b>" },
      });

      const driver = fakeDriver({ failKind: "transient", failTimes: 1 });
      const worker = new EmailOutboxWorker({
        storage,
        driver,
        now: () => now,
        retry: DEFAULT_EMAIL_OUTBOX_RETRY,
        batchSize: 10,
      });
      await worker.runOnce(); // moves to retry, nextAttemptAt in future

      // Run again immediately — no time has passed.
      const r = await worker.runOnce();
      expect(r.sent).toBe(0);
      expect(r.retry).toBe(0);
      expect(r.deadLetter).toBe(0);
      // Driver was only called once (the original attempt).
      expect(driver.calls).toBe(1);
    });

    it("reports lag = age of the oldest pending record", async () => {
      const storage = makeStorage();
      const recorder = new EmailOutboxRecorder({ storage, now: () => now });
      const earlier = new Date(now.getTime() - 60_000);
      // Override createdAt to simulate an old pending record.
      storage.records.push({
        id: "rec-1",
        kind: "send",
        payload: { to: "u@x", subject: "S", html: "<b>x</b>" },
        idempotencyKey: null,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: null,
        claimedAt: null,
        lastError: null,
        succeededAt: null,
        failedAt: null,
        createdAt: earlier,
        updatedAt: earlier,
      });
      void recorder;

      const lag = await storage.oldestPendingAge(now);
      expect(lag).toBe(60_000);
    });
  });
});
