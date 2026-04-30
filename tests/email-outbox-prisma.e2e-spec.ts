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

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the email-outbox e2e suite");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    storage = new PrismaEmailOutboxStorage(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Test isolation — each test starts from a clean table.
    await prisma.emailOutbox.deleteMany({});
  });

  it("appends a record and reads it back as dispatchable", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    const entry = await recorder.enqueue({
      kind: "send",
      payload: { to: "test@example.com", subject: "Hi", html: "<b>hi</b>" },
    });
    expect(entry.id).toBeDefined();

    const list = await storage.listDispatchable(new Date(), 10);
    expect(list).toHaveLength(1);
    expect(list[0]!.kind).toBe("send");
  });

  it("idempotency-key dedups concurrent enqueues to a single row", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    const a = await recorder.enqueue({
      kind: "send",
      idempotencyKey: "verify:user-1",
      payload: { to: "u@example.com", subject: "Verify", html: "<a>x</a>" },
    });
    const b = await recorder.enqueue({
      kind: "send",
      idempotencyKey: "verify:user-1",
      payload: { to: "u@example.com", subject: "Verify (dup)", html: "<a>y</a>" },
    });
    expect(b.id).toBe(a.id);
    const all = await prisma.emailOutbox.findMany();
    expect(all).toHaveLength(1);
  });

  it("worker dispatches a pending record and marks it sent", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    await recorder.enqueue({
      kind: "send",
      payload: { to: "test@example.com", subject: "Hi", html: "<b>hi</b>" },
    });

    const driver: EmailOutboxDriver = {
      async dispatch() {
        return { messageId: "ok-1", driver: "fake" };
      },
    };
    const worker = new EmailOutboxWorker({ storage, driver, batchSize: 10 });
    const result = await worker.runOnce();
    expect(result.sent).toBe(1);

    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("SENT");
    expect(row.succeededAt).not.toBeNull();
    expect(row.claimedAt).toBeNull();
  });

  it("worker dead-letters after maxAttempts transient failures", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    await recorder.enqueue({
      kind: "send",
      payload: { to: "test@example.com", subject: "Hi", html: "<b>hi</b>" },
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
    expect(r1.retry).toBe(1);
    let row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("PENDING");
    expect(row.attemptCount).toBe(1);

    // Advance past the backoff and tick again.
    now = new Date(row.nextAttemptAt!.getTime() + 1);
    const r2 = await worker.runOnce();
    expect(r2.deadLetter).toBe(1);
    row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("DEAD_LETTER");
    expect(row.lastError).toMatch(/transient/);
    expect(row.failedAt).not.toBeNull();
  });

  it("oldestPendingAge() reports lag for the readiness probe", async () => {
    const recorder = new EmailOutboxRecorder({ storage });
    await recorder.enqueue({
      kind: "send",
      payload: { to: "test@example.com", subject: "Hi", html: "<b>hi</b>" },
    });
    const lagFresh = await storage.oldestPendingAge(new Date());
    expect(lagFresh).toBeGreaterThanOrEqual(0);

    // Manually move the createdAt back one minute → lag ~60s.
    await prisma.emailOutbox.updateMany({
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    const lagOld = await storage.oldestPendingAge(new Date());
    expect(lagOld).toBeGreaterThanOrEqual(60_000);
  });
});
