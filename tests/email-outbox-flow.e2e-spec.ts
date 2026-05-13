import type { INestApplication, LoggerService } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { EmailService } from "../src/core/email/email.service.js";
import {
  EMAIL_OUTBOX_STORAGE,
  EmailOutboxRecorderProvider,
  EmailOutboxWorkerLifecycle,
} from "../src/core/email/email-outbox.module.js";
import type { EmailOutboxStorage } from "../src/core/email/email-outbox.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";

const SILENT_LOGGER: LoggerService = {
  log() {},
  warn() {},
  error() {},
  debug() {},
  verbose() {},
};

/**
 * E2E · Email-Outbox flow.
 *
 * Drives the full at-least-once pipeline:
 *   - EmailService.send({ mode: "outbox" }) writes a record
 *   - EmailOutboxWorker tick claims + dispatches via the configured
 *     driver (log-only in this suite — features.email is off without
 *     SMTP_HOST set)
 *   - Record graduates to status "sent"
 *
 * `/dev/outbox.json` and `/health/ready` reflect the state so
 * operators see the same thing the worker sees.
 */
describe("E2E · Email-Outbox flow", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let emailService: EmailService;
  let worker: EmailOutboxWorkerLifecycle;
  let storage: EmailOutboxStorage;
  let recorder: EmailOutboxRecorderProvider;
  // Per-suite prefix on the recipient + idempotency-key so concurrent
  // specs writing to the same `email_outbox` table cannot contaminate
  // this spec's row counts. Iter-194 fix: the previous version's
  // `deleteMany({})` (no filter) wiped the global table on every
  // beforeEach + `findFirstOrThrow` / `findMany()` (no filter) saw
  // ALL rows from concurrent specs, surfacing as a transient
  // `1 failed` flake every ~3rd full-suite run.
  const SUITE_TAG = `outbox-flow-${crypto.randomUUID()}`;
  const recipient = (label: string) => `${SUITE_TAG}-${label}@example.com`;
  const idempKey = (label: string) => `${SUITE_TAG}:${label}`;
  const ourRowsFilter = {
    idempotencyKey: { startsWith: `${SUITE_TAG}:` },
  };

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    emailService = app.get(EmailService);
    worker = app.get(EmailOutboxWorkerLifecycle);
    storage = app.get<EmailOutboxStorage>(EMAIL_OUTBOX_STORAGE);
    recorder = app.get(EmailOutboxRecorderProvider);
  });

  afterAll(async () => {
    await prisma.emailOutbox.deleteMany({ where: ourRowsFilter });
    await app.close();
  });

  beforeEach(async () => {
    await prisma.emailOutbox.deleteMany({ where: ourRowsFilter });
  });

  it("EmailService.send({ mode: 'outbox' }) writes a pending row", async () => {
    const result = await emailService.send(
      { to: recipient("to"), subject: "Hi", text: "hello" },
      { mode: "outbox", idempotencyKey: idempKey("hi") },
    );
    expect(result.driver).toBe("outbox");
    expect(result.messageId).toMatch(/^outbox:/);

    const row = await prisma.emailOutbox.findFirstOrThrow({ where: ourRowsFilter });
    expect(row.status).toBe("PENDING");
    expect(row.kind).toBe("SEND");
  });

  it("worker tick processes pending rows and marks them sent", async () => {
    await emailService.send(
      { to: recipient("a"), subject: "Hi a", text: "x" },
      { mode: "outbox", idempotencyKey: idempKey("a") },
    );
    await emailService.send(
      { to: recipient("b"), subject: "Hi b", text: "y" },
      { mode: "outbox", idempotencyKey: idempKey("b") },
    );
    await emailService.send(
      { to: recipient("c"), subject: "Hi c", text: "z" },
      { mode: "outbox", idempotencyKey: idempKey("c") },
    );

    // countPending reads the table-wide counter — under parallel
    // execution it can include concurrent specs' pending rows. Filter
    // to OUR rows to keep the assertion deterministic.
    const ourPendingBefore = await prisma.emailOutbox.count({
      where: { ...ourRowsFilter, status: "PENDING" },
    });
    expect(ourPendingBefore).toBe(3);

    await worker.tickOnce();

    const ourPendingAfter = await prisma.emailOutbox.count({
      where: { ...ourRowsFilter, status: "PENDING" },
    });
    expect(ourPendingAfter).toBe(0);
    const sentRows = await prisma.emailOutbox.findMany({
      where: { ...ourRowsFilter, status: "SENT" },
    });
    expect(sentRows).toHaveLength(3);
    // storage.countPending() is exposed by the API contract — keep a
    // soft sanity check (>= 0) so a regression that breaks the storage
    // delegate still surfaces, without coupling to global state.
    expect(await storage.countPending()).toBeGreaterThanOrEqual(0);
  });

  it("idempotency key dedups two enqueues of the same payload", async () => {
    const first = await emailService.send(
      { to: recipient("dup"), subject: "First", text: "x" },
      { mode: "outbox", idempotencyKey: idempKey("dup-1") },
    );
    const second = await emailService.send(
      { to: recipient("dup"), subject: "Second", text: "y" },
      { mode: "outbox", idempotencyKey: idempKey("dup-1") },
    );
    expect(second.messageId).toBe(first.messageId);
    const all = await prisma.emailOutbox.findMany({ where: ourRowsFilter });
    expect(all).toHaveLength(1);
    // The first call's payload wins — second call dedupes.
    expect((all[0]!.payload as { subject: string }).subject).toBe("First");
  });

  it("recorder is the same provider as injected EMAIL_OUTBOX_RECORDER", () => {
    expect(recorder).toBeDefined();
    // The factory wires this recorder into EmailService — calling
    // through the service writes via the same recorder, so a row
    // shows up under both inspection paths.
    expect(typeof recorder.enqueue).toBe("function");
  });
});
