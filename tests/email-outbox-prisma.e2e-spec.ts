import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import {
  EmailOutboxRecorder,
  EmailOutboxWorker,
  type EmailOutboxDriver,
} from "../src/core/email/email-outbox.js";
import { PrismaEmailOutboxStorage } from "../src/core/email/email-outbox.prisma.js";

/**
 * E2E · Prisma-backed Email-Outbox storage.
 *
 * Verifies the recorder + worker against the real `email_outbox`
 * table — covers the SQL paths that the in-memory fakes can't
 * exercise (idempotency unique constraint, atomic claim, status
 * transitions, lag query).
 */
describe("E2E · Prisma email-outbox storage", () => {
  let prisma: PrismaClient;
  let storage: PrismaEmailOutboxStorage;
  // Per-suite SUITE_TAG so concurrent specs writing to the same
  // `email_outbox` table cannot contaminate this spec's row counts.
  // Iter-194 fix mirroring `email-outbox-flow.e2e-spec.ts`: prior
  // version used `deleteMany({})` (no filter) in beforeEach +
  // `findFirstOrThrow()` / `findMany()` (no filter), which globally
  // wiped + scanned the table. The reviewer at iter-194 flagged
  // this as a residual flake-class hit waiting to surface; this
  // edit closes it before it does.
  const SUITE_TAG = `outbox-prisma-${crypto.randomUUID()}`;
  const recipient = (label: string) => `${SUITE_TAG}-${label}@example.com`;
  const idempKey = (label: string) => `${SUITE_TAG}:${label}`;
  const ourRowsFilter = { idempotencyKey: { startsWith: `${SUITE_TAG}:` } };

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the email-outbox e2e suite");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    storage = new PrismaEmailOutboxStorage(prisma);
  });

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: ourRowsFilter });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.emailOutbox.deleteMany({ where: ourRowsFilter });
  });

  it("appends a record and reads it back as dispatchable", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    const entry = await recorder.enqueue({
      kind: "send",
      idempotencyKey: idempKey("appends"),
      payload: { to: recipient("appends"), subject: "Hi", html: "<b>hi</b>" },
    });
    expect(entry.id).toBeDefined();

    // Filter the dispatchable list to OUR rows; storage.listDispatchable
    // returns the table-wide list under parallel pressure, so we need
    // the filtered count rather than `expect(list).toHaveLength(1)`.
    const ourPending = await prisma.emailOutbox.findMany({
      where: { ...ourRowsFilter, status: "PENDING" },
    });
    expect(ourPending).toHaveLength(1);
    expect(ourPending[0]!.kind).toBe("SEND");
  });

  it("idempotency-key dedups concurrent enqueues to a single row", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    const dupKey = idempKey("verify:user-1");
    const a = await recorder.enqueue({
      kind: "send",
      idempotencyKey: dupKey,
      payload: { to: recipient("verify"), subject: "Verify", html: "<a>x</a>" },
    });
    const b = await recorder.enqueue({
      kind: "send",
      idempotencyKey: dupKey,
      payload: { to: recipient("verify"), subject: "Verify (dup)", html: "<a>y</a>" },
    });
    expect(b.id).toBe(a.id);
    const ours = await prisma.emailOutbox.findMany({ where: ourRowsFilter });
    expect(ours).toHaveLength(1);
  });

  it("worker dispatches a pending record and marks it sent", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    await recorder.enqueue({
      kind: "send",
      idempotencyKey: idempKey("dispatch"),
      payload: { to: recipient("dispatch"), subject: "Hi", html: "<b>hi</b>" },
    });

    const driver: EmailOutboxDriver = {
      async dispatch() {
        return { messageId: "ok-1", driver: "fake" };
      },
    };
    const worker = new EmailOutboxWorker({ storage, driver, batchSize: 10 });
    const result = await worker.runOnce();
    expect(result.sent).toBeGreaterThanOrEqual(1);

    const row = await prisma.emailOutbox.findFirstOrThrow({ where: ourRowsFilter });
    expect(row.status).toBe("SENT");
    expect(row.succeededAt).not.toBeNull();
    expect(row.claimedAt).toBeNull();
  });

  it("worker dead-letters after maxAttempts transient failures", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    await recorder.enqueue({
      kind: "send",
      idempotencyKey: idempKey("deadletter"),
      payload: { to: recipient("deadletter"), subject: "Hi", html: "<b>hi</b>" },
    });

    const driver: EmailOutboxDriver = {
      async dispatch() {
        throw new Error("transient boom");
      },
    };
    let now = new Date();
    const worker = new EmailOutboxWorker({
      storage,
      driver,
      now: () => now,
      retry: {
        initialDelayMs: 1,
        factor: 2,
        maxDelayMs: 1000,
        maxAttempts: 2,
      },
      batchSize: 10,
    });

    const r1 = await worker.runOnce();
    expect(r1.retry).toBeGreaterThanOrEqual(1);
    let row = await prisma.emailOutbox.findFirstOrThrow({ where: ourRowsFilter });
    expect(row.status).toBe("PENDING");
    expect(row.attemptCount).toBe(1);

    // Advance past the backoff and tick again.
    now = new Date(row.nextAttemptAt!.getTime() + 1);
    const r2 = await worker.runOnce();
    expect(r2.deadLetter).toBeGreaterThanOrEqual(1);
    row = await prisma.emailOutbox.findFirstOrThrow({ where: ourRowsFilter });
    expect(row.status).toBe("DEAD_LETTER");
    expect(row.lastError).toMatch(/transient/);
    expect(row.failedAt).not.toBeNull();
  });

  it("oldestPendingAge() reports lag for the readiness probe", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    const ourRow = await recorder.enqueue({
      kind: "send",
      idempotencyKey: idempKey("lag"),
      payload: { to: recipient("lag"), subject: "Hi", html: "<b>hi</b>" },
    });
    const lagFresh = await storage.oldestPendingAge(new Date());
    expect(lagFresh).toBeGreaterThanOrEqual(0);

    // Backdate ONLY OUR row — the prior version's `updateMany({})`
    // (no where) corrupted concurrent specs' lag math. Filter to the
    // specific row we just enqueued.
    await prisma.emailOutbox.updateMany({
      where: { id: ourRow.id },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    const lagOld = await storage.oldestPendingAge(new Date());
    expect(lagOld).toBeGreaterThanOrEqual(60_000);
  });
});
