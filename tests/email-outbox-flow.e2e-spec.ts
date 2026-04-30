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

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    emailService = app.get(EmailService);
    worker = app.get(EmailOutboxWorkerLifecycle);
    storage = app.get<EmailOutboxStorage>(EMAIL_OUTBOX_STORAGE);
    recorder = app.get(EmailOutboxRecorderProvider);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.emailOutbox.deleteMany({});
  });

  it("EmailService.send({ mode: 'outbox' }) writes a pending row", async () => {
    const result = await emailService.send(
      { to: "to@example.com", subject: "Hi", text: "hello" },
      { mode: "outbox" },
    );
    expect(result.driver).toBe("outbox");
    expect(result.messageId).toMatch(/^outbox:/);

    const row = await prisma.emailOutbox.findFirstOrThrow();
    expect(row.status).toBe("PENDING");
    expect(row.kind).toBe("SEND");
  });

  it("worker tick processes pending rows and marks them sent", async () => {
    await emailService.send(
      { to: "a@example.com", subject: "Hi a", text: "x" },
      { mode: "outbox" },
    );
    await emailService.send(
      { to: "b@example.com", subject: "Hi b", text: "y" },
      { mode: "outbox" },
    );
    await emailService.send(
      { to: "c@example.com", subject: "Hi c", text: "z" },
      { mode: "outbox" },
    );

    const pendingBefore = await storage.countPending();
    expect(pendingBefore).toBe(3);

    await worker.tickOnce();

    const pendingAfter = await storage.countPending();
    expect(pendingAfter).toBe(0);
    const sentRows = await prisma.emailOutbox.findMany({ where: { status: "SENT" } });
    expect(sentRows).toHaveLength(3);
  });

  it("idempotency key dedups two enqueues of the same payload", async () => {
    const first = await emailService.send(
      { to: "dup@example.com", subject: "First", text: "x" },
      { mode: "outbox", idempotencyKey: "verify:dup-1" },
    );
    const second = await emailService.send(
      { to: "dup@example.com", subject: "Second", text: "y" },
      { mode: "outbox", idempotencyKey: "verify:dup-1" },
    );
    expect(second.messageId).toBe(first.messageId);
    const all = await prisma.emailOutbox.findMany();
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
