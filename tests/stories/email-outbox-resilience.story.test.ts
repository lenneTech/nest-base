import { describe, expect, it } from "vitest";

import {
  EmailOutboxWorker,
  type EmailOutboxDriver,
  type EmailOutboxRecord,
  type EmailOutboxStorage,
} from "../../src/core/email/email-outbox.js";

/**
 * Story · EmailOutboxWorker resilience to storage failures.
 *
 * Issue #50 traced the `{}` log-spam to the lifecycle wrapper logging
 * a non-Error throw verbatim. The `serializeOutboxTickError` helper
 * (Phase 1) now formats the throw correctly, but the `runOnce()` body
 * itself is also brittle: only the dispatch step lives inside a
 * try/catch — `listDispatchable()` and `claim()` happen outside, so a
 * storage failure (driver-adapter pool exhaustion, prisma disconnect
 * race during graceful shutdown, transient timeout) crashes the
 * entire tick loop with whatever shape the storage decides to throw.
 *
 * Phase 2 wraps the boundary calls so:
 *   - a `listDispatchable()` failure surfaces a real `Error` with a
 *     useful message and the worker tick degrades to "did nothing
 *     this round, retry next tick"
 *   - a `claim()` failure on one record skips that record but lets
 *     siblings continue
 *
 * The worker's contract: `runOnce()` either resolves with a result or
 * rejects with an `Error` carrying a real `.message` — never with a
 * raw `{}` / `null` / `undefined` value.
 */
describe("Story · EmailOutboxWorker resilience", () => {
  function makeRecord(overrides?: Partial<EmailOutboxRecord>): EmailOutboxRecord {
    return {
      id: "rec-1",
      kind: "send",
      payload: { to: "user@example.com", subject: "Hi", text: "Hello" },
      idempotencyKey: null,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: null,
      claimedAt: null,
      lastError: null,
      succeededAt: null,
      failedAt: null,
      createdAt: new Date("2026-04-30T12:00:00.000Z"),
      updatedAt: new Date("2026-04-30T12:00:00.000Z"),
      ...overrides,
    };
  }

  function makeDriver(): EmailOutboxDriver {
    return {
      async dispatch() {
        return { messageId: "ok", driver: "fake" };
      },
    };
  }

  it("rejects with a real Error when listDispatchable throws a plain object", async () => {
    // Prisma's driver-adapter sometimes throws non-Error shapes on
    // pool exhaustion / disconnect — historically the worker
    // propagated these as-is and the lifecycle wrapper logged "{}".
    const storage: EmailOutboxStorage = {
      async append() {
        /* no-op */
      },
      async findByIdempotencyKey() {
        return null;
      },
      async listDispatchable() {
        throw { code: "P2024", message: "Timed out fetching a connection" };
      },
      async claim() {
        return false;
      },
      async markSent() {
        return false;
      },
      async markDeadLetter() {
        return false;
      },
      async recordTransientFailure() {
        return false;
      },
      async countPending() {
        return 0;
      },
      async oldestPendingAge() {
        return 0;
      },
    };

    const worker = new EmailOutboxWorker({ storage, driver: makeDriver() });
    await expect(worker.runOnce()).rejects.toThrow(/P2024.*Timed out fetching a connection/);
  });

  it("rejects with a real Error when listDispatchable throws null", async () => {
    // Defensive: an upstream library throwing `null` is rare but
    // observed. The serializer catches it at the lifecycle level —
    // the worker should still give a useful Error with a non-empty
    // message.
    const storage: EmailOutboxStorage = {
      async append() {
        /* no-op */
      },
      async findByIdempotencyKey() {
        return null;
      },
      async listDispatchable() {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw null;
      },
      async claim() {
        return false;
      },
      async markSent() {
        return false;
      },
      async markDeadLetter() {
        return false;
      },
      async recordTransientFailure() {
        return false;
      },
      async countPending() {
        return 0;
      },
      async oldestPendingAge() {
        return 0;
      },
    };

    const worker = new EmailOutboxWorker({ storage, driver: makeDriver() });
    await expect(worker.runOnce()).rejects.toThrow(Error);
    await expect(worker.runOnce()).rejects.toThrow(/listDispatchable/i);
  });

  it("continues processing siblings when a single claim fails", async () => {
    // claim() throwing on row A must not abort the tick — row B's
    // dispatch should still happen on the same run.
    const records = [makeRecord({ id: "a" }), makeRecord({ id: "b" })];
    let dispatchCount = 0;

    const storage: EmailOutboxStorage = {
      async append() {
        /* no-op */
      },
      async findByIdempotencyKey() {
        return null;
      },
      async listDispatchable() {
        return records;
      },
      async claim(id) {
        if (id === "a") {
          throw { message: "row-level lock conflict" };
        }
        return true;
      },
      async markSent() {
        return true;
      },
      async markDeadLetter() {
        return true;
      },
      async recordTransientFailure() {
        return true;
      },
      async countPending() {
        return 0;
      },
      async oldestPendingAge() {
        return 0;
      },
    };

    const driver: EmailOutboxDriver = {
      async dispatch() {
        dispatchCount++;
        return { messageId: "ok", driver: "fake" };
      },
    };

    const worker = new EmailOutboxWorker({ storage, driver });
    const result = await worker.runOnce();
    // Row B was dispatched — row A's claim error did not abort.
    expect(dispatchCount).toBe(1);
    expect(result.sent).toBe(1);
  });
});
