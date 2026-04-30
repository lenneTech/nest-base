import { describe, expect, it } from "vitest";

import {
  SmtpEmailDriver,
  composeSmtpPayload,
  type SmtpTransporter,
} from "../../src/core/email/drivers/smtp.driver.js";
import type { EmailMessage } from "../../src/core/email/email.service.js";

/**
 * Story · SmtpEmailDriver.
 *
 * Wraps Nodemailer (or any compatible transporter). The driver itself
 * is thin glue; the payload-shaping logic lives in `composeSmtpPayload`
 * (pure planner) so we can assert it without ever opening a socket.
 *
 * Tests use a fake transporter — `nodemailer` ships `jsonTransport` for
 * exactly this purpose, but a hand-rolled fake is even simpler and
 * keeps the test independent of any third-party lib.
 */
describe("Story · SmtpEmailDriver", () => {
  function fakeTransporter(
    mode: "ok" | "fail" = "ok",
  ): SmtpTransporter & { sent: object[] } {
    const sent: object[] = [];
    return {
      sent,
      async sendMail(envelope: object): Promise<{ messageId: string }> {
        if (mode === "fail") {
          const err = new Error("EAUTH: Invalid login: 535 Authentication failed");
          (err as Error & { code?: string }).code = "EAUTH";
          throw err;
        }
        sent.push(envelope);
        return { messageId: `<smtp-${sent.length}@test>` };
      },
    };
  }

  describe("composeSmtpPayload (pure planner)", () => {
    it("forwards every recognised field 1:1", () => {
      const msg: EmailMessage = {
        to: "user@example.com",
        from: "noreply@example.com",
        subject: "hi",
        html: "<p>hi</p>",
        text: "hi",
      };
      expect(composeSmtpPayload(msg)).toEqual({
        to: "user@example.com",
        from: "noreply@example.com",
        subject: "hi",
        html: "<p>hi</p>",
        text: "hi",
      });
    });

    it("omits optional fields when not provided", () => {
      const payload = composeSmtpPayload({
        to: "u@example.com",
        from: "noreply@example.com",
        subject: "s",
      });
      expect(payload).not.toHaveProperty("html");
      expect(payload).not.toHaveProperty("text");
    });
  });

  describe("send()", () => {
    it("calls sendMail with the composed payload and maps the result", async () => {
      const transporter = fakeTransporter();
      const driver = new SmtpEmailDriver({ transporter });
      const result = await driver.send({
        to: "user@example.com",
        from: "noreply@example.com",
        subject: "hi",
        text: "hello",
      });
      expect(transporter.sent).toHaveLength(1);
      expect(transporter.sent[0]).toMatchObject({
        to: "user@example.com",
        from: "noreply@example.com",
        subject: "hi",
        text: "hello",
      });
      expect(result.driver).toBe("smtp");
      expect(result.messageId).toBe("<smtp-1@test>");
    });

    it("propagates transporter failures with a clear log-friendly error", async () => {
      const transporter = fakeTransporter("fail");
      const driver = new SmtpEmailDriver({ transporter });
      await expect(
        driver.send({
          to: "u@example.com",
          from: "noreply@example.com",
          subject: "s",
          text: "t",
        }),
      ).rejects.toThrow(/EAUTH/);
    });
  });

  describe("sendTemplate()", () => {
    it("rejects — only Brevo supports brevoTemplateId", async () => {
      const transporter = fakeTransporter();
      const driver = new SmtpEmailDriver({ transporter });
      await expect(
        driver.sendTemplate(
          { to: "u@example.com", from: "noreply@example.com", subject: "" },
          42,
          {},
        ),
      ).rejects.toThrow(/smtp does not support brevoTemplateId/i);
    });
  });

  describe("driver name", () => {
    it("identifies itself as 'smtp'", () => {
      const driver = new SmtpEmailDriver({ transporter: fakeTransporter() });
      expect(driver.name).toBe("smtp");
    });
  });
});
