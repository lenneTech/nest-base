import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

import {
  SmtpEmailDriver,
  createSmtpTransporter,
} from "../src/core/email/drivers/smtp.driver.js";

/**
 * E2E · SMTP-Driver against Mailpit.
 *
 * Spins up an `axllent/mailpit` testcontainer (matches docker-compose's
 * service of the same name), drives a real Nodemailer transport against
 * it, and asserts the message lands in Mailpit's REST API. Tests are
 * gated on a reachable Docker daemon — `testcontainers` already throws
 * a friendly diagnostic if Docker is missing.
 *
 * Why a testcontainer and not docker-compose: the e2e step in CI must
 * stand on its own, without relying on a sidecar. Mailpit's image is
 * tiny (~12 MB) and boots in a second.
 */
describe("E2E · SMTP-Driver against Mailpit", () => {
  let container: StartedTestContainer | undefined;
  let smtpHost: string;
  let smtpPort: number;
  let httpUrl: string;

  beforeAll(async () => {
    // `--smtp-disable-rdns` matters: without it, Mailpit performs a
    // reverse-DNS lookup of the connecting client IP before sending
    // the SMTP greeting. In testcontainers (Docker NAT, no PTR record
    // for the bridge subnet) that lookup blocks until timeout, which
    // looks identical to a hung connection from the client's side.
    container = await new GenericContainer("axllent/mailpit:latest")
      .withExposedPorts(1025, 8025)
      .withCommand(["--smtp-disable-rdns"])
      .withEnvironment({
        MP_SMTP_AUTH_ACCEPT_ANY: "1",
        MP_SMTP_AUTH_ALLOW_INSECURE: "1",
      })
      .withWaitStrategy(Wait.forListeningPorts())
      .start();
    smtpHost = container.getHost();
    smtpPort = container.getMappedPort(1025);
    const httpPort = container.getMappedPort(8025);
    httpUrl = `http://${smtpHost}:${httpPort}`;
  }, 60_000);

  afterAll(async () => {
    if (container) await container.stop();
  });

  it("delivers a plain-text mail to Mailpit and Mailpit's API exposes it", async () => {
    const transporter = createSmtpTransporter({
      host: smtpHost,
      port: smtpPort,
      secure: false,
      timeoutMs: 10_000,
    });
    const driver = new SmtpEmailDriver({ transporter });
    const subject = `e2e-smtp-${Date.now()}`;
    const result = await driver.send({
      to: "test@example.com",
      from: "noreply@example.com",
      subject,
      text: "hello from the e2e test",
    });
    expect(result.driver).toBe("smtp");
    expect(result.messageId).toMatch(/@/);

    // Close the pool so the test process exits cleanly.
    transporter.close();

    const list = await fetch(`${httpUrl}/api/v1/messages`).then((r) => r.json() as Promise<{
      messages: Array<{ Subject: string; To: Array<{ Address: string }> }>;
    }>);
    const found = list.messages.find((m) => m.Subject === subject);
    expect(found, `no Mailpit message with subject ${subject}`).toBeDefined();
    expect(found?.To?.[0]?.Address).toBe("test@example.com");
  }, 30_000);

  it("delivers HTML body alongside text body when both are set", async () => {
    const transporter = createSmtpTransporter({
      host: smtpHost,
      port: smtpPort,
      secure: false,
      timeoutMs: 10_000,
    });
    const driver = new SmtpEmailDriver({ transporter });
    const subject = `e2e-smtp-html-${Date.now()}`;
    await driver.send({
      to: "html@example.com",
      from: "noreply@example.com",
      subject,
      html: "<p>hello <strong>html</strong></p>",
      text: "hello html",
    });
    transporter.close();

    const list = await fetch(`${httpUrl}/api/v1/messages`).then((r) => r.json() as Promise<{
      messages: Array<{ ID: string; Subject: string }>;
    }>);
    const msg = list.messages.find((m) => m.Subject === subject);
    expect(msg).toBeDefined();
    if (!msg) return;
    const detail = await fetch(`${httpUrl}/api/v1/message/${msg.ID}`).then(
      (r) => r.json() as Promise<{ HTML: string; Text: string }>,
    );
    expect(detail.HTML).toContain("<strong>html</strong>");
    expect(detail.Text).toContain("hello html");
  }, 30_000);
});
