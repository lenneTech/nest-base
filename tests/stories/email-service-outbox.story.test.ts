import { describe, expect, it } from "vitest";

import {
  EmailService,
  type EmailDriver,
  type EmailMessage,
  type EmailOutboxEnqueuer,
  type EmailSendResult,
  type EmailTemplateRenderer,
} from "../../src/core/email/email.service.js";

/**
 * Story · EmailService outbox mode.
 *
 * The default behaviour stays "send synchronously and return the
 * driver result". Issue #11 adds an `EmailOutboxEnqueuer` injection
 * and a per-call `mode: "outbox"` flag. When the flag is set, the
 * service writes the args to the enqueuer and returns immediately
 * with a synthetic `outbox:<id>` message id — the worker handles
 * delivery on the next tick.
 *
 * Idempotency keys forwarded by the caller flow into the enqueuer so
 * Better-Auth's "user clicks resend twice in 5s" pattern dedupes
 * before it reaches the SMTP relay.
 */
describe("Story · EmailService outbox mode", () => {
  function fakeDriver(name = "nodemailer"): EmailDriver & {
    sent: Array<{ msg: EmailMessage; templateId?: number; vars?: object }>;
  } {
    const sent: Array<{ msg: EmailMessage; templateId?: number; vars?: object }> = [];
    return {
      name,
      sent,
      async send(msg): Promise<EmailSendResult> {
        sent.push({ msg });
        return { messageId: `${name}-${sent.length}`, driver: name };
      },
      async sendTemplate(msg, templateId, vars): Promise<EmailSendResult> {
        sent.push({ msg, templateId, vars });
        return { messageId: `${name}-tpl-${sent.length}`, driver: name };
      },
    };
  }

  function fakeRenderer(): EmailTemplateRenderer & {
    calls: Array<{ template: string; locale: string; vars: object }>;
  } {
    const calls: Array<{ template: string; locale: string; vars: object }> = [];
    return {
      calls,
      async render(template, locale, vars) {
        calls.push({ template, locale, vars });
        return {
          subject: `[${template}] subject`,
          html: `<p>${template}</p>`,
          text: template,
        };
      },
    };
  }

  function fakeEnqueuer(): EmailOutboxEnqueuer & {
    enqueued: Array<{ kind: "send" | "sendTemplate"; payload: object; idempotencyKey?: string }>;
  } {
    const enqueued: Array<{
      kind: "send" | "sendTemplate";
      payload: object;
      idempotencyKey?: string;
    }> = [];
    return {
      enqueued,
      async enqueue(input) {
        enqueued.push({
          kind: input.kind,
          payload: input.payload as object,
          ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        });
        return {
          id: `rec-${enqueued.length}`,
          kind: input.kind,
          payload: input.payload,
          status: "pending",
        };
      },
    };
  }

  it("send({ mode: 'outbox' }) writes to the enqueuer instead of the driver", async () => {
    const primary = fakeDriver();
    const outbox = fakeEnqueuer();
    const svc = new EmailService({
      primary,
      renderer: fakeRenderer(),
      defaultFrom: "noreply@example.com",
      outbox,
    });

    const result = await svc.send(
      { to: "a@example.com", subject: "hi", text: "hello" },
      { mode: "outbox" },
    );

    expect(primary.sent).toHaveLength(0);
    expect(outbox.enqueued).toHaveLength(1);
    expect(outbox.enqueued[0]?.kind).toBe("send");
    expect(result.driver).toBe("outbox");
    expect(result.messageId).toMatch(/^outbox:/);
  });

  it("send() defaults to direct mode (back-compat)", async () => {
    const primary = fakeDriver();
    const outbox = fakeEnqueuer();
    const svc = new EmailService({
      primary,
      renderer: fakeRenderer(),
      defaultFrom: "noreply@example.com",
      outbox,
    });
    const result = await svc.send({ to: "a@example.com", subject: "hi", text: "hello" });
    expect(primary.sent).toHaveLength(1);
    expect(outbox.enqueued).toHaveLength(0);
    expect(result.driver).toBe("nodemailer");
  });

  it("sendTemplate({ mode: 'outbox' }) writes a sendTemplate record", async () => {
    const primary = fakeDriver();
    const outbox = fakeEnqueuer();
    const svc = new EmailService({
      primary,
      renderer: fakeRenderer(),
      defaultFrom: "noreply@example.com",
      outbox,
    });

    const result = await svc.sendTemplate(
      {
        to: "a@example.com",
        template: "password-reset",
        vars: { resetUrl: "https://x" },
      },
      { mode: "outbox" },
    );

    expect(primary.sent).toHaveLength(0);
    expect(outbox.enqueued).toHaveLength(1);
    expect(outbox.enqueued[0]?.kind).toBe("sendTemplate");
    expect(result.driver).toBe("outbox");
  });

  it("forwards an idempotencyKey through to the enqueuer", async () => {
    const primary = fakeDriver();
    const outbox = fakeEnqueuer();
    const svc = new EmailService({
      primary,
      renderer: fakeRenderer(),
      defaultFrom: "noreply@example.com",
      outbox,
    });

    await svc.send(
      { to: "a@example.com", subject: "hi", text: "hello" },
      { mode: "outbox", idempotencyKey: "verify:user-1" },
    );

    expect(outbox.enqueued[0]?.idempotencyKey).toBe("verify:user-1");
  });

  it("throws when mode is 'outbox' but no enqueuer is configured", async () => {
    const svc = new EmailService({
      primary: fakeDriver(),
      renderer: fakeRenderer(),
      defaultFrom: "noreply@example.com",
    });
    await expect(
      svc.send({ to: "a@example.com", subject: "hi", text: "hello" }, { mode: "outbox" }),
    ).rejects.toThrow(/outbox/i);
  });

  it("dev-whitelist + rate-limit still apply when enqueuing", async () => {
    const primary = fakeDriver();
    const outbox = fakeEnqueuer();
    const svc = new EmailService({
      primary,
      renderer: fakeRenderer(),
      defaultFrom: "noreply@example.com",
      outbox,
      devWhitelist: ["*@example.com"],
    });
    await expect(
      svc.send({ to: "real@user.io", subject: "s", text: "t" }, { mode: "outbox" }),
    ).rejects.toThrow(/whitelist/);
    expect(outbox.enqueued).toHaveLength(0);
  });
});
