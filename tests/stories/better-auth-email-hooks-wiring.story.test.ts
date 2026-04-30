import { describe, expect, it } from "vitest";

import { buildBetterAuth } from "../../src/core/auth/better-auth.js";
import type { EmailSenderForHooks } from "../../src/core/auth/better-auth-email-hooks.runner.js";

/**
 * Story · Better-Auth ↔ EmailService wiring.
 *
 * The factory accepts an optional `emailHooks` object pointing at an
 * `EmailService`-shaped sender. When set, the resulting Better-Auth
 * instance fires real templates on sign-up and password-reset — the
 * hook payloads are visible in the `options.emailVerification` /
 * `options.emailAndPassword` blocks.
 */
describe("Story · Better-Auth email-hooks wiring", () => {
  function fakeSender(): EmailSenderForHooks & {
    calls: Array<{ template: string; to: string; vars: object }>;
  } {
    const calls: Array<{ template: string; to: string; vars: object }> = [];
    return {
      calls,
      async sendTemplate(args) {
        calls.push({ template: args.template, to: args.to, vars: args.vars ?? {} });
        return { messageId: `fake-${calls.length}`, driver: "fake" };
      },
    };
  }

  it("does NOT register sendVerificationEmail / sendResetPassword when emailHooks is omitted", () => {
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
    });
    // Without an email service, Better-Auth's built-in fallback handles
    // verification — i.e. there is no caller-supplied function.
    expect(auth.options.emailVerification?.sendVerificationEmail).toBeUndefined();
    expect(auth.options.emailAndPassword?.sendResetPassword).toBeUndefined();
  });

  it("registers sendVerificationEmail when an email sender is supplied", async () => {
    const sender = fakeSender();
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      emailHooks: { sender, appName: "Acme" },
    });
    const fn = auth.options.emailVerification?.sendVerificationEmail;
    expect(typeof fn).toBe("function");
    if (!fn) return;
    await fn({
      user: {
        id: "u1",
        email: "alice@example.com",
        name: "Alice",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      url: "https://x/verify?t=1",
      token: "t1",
    });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      template: "email-verification",
      to: "alice@example.com",
    });
  });

  it("registers sendResetPassword when an email sender is supplied", async () => {
    const sender = fakeSender();
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      emailHooks: { sender, appName: "Acme" },
    });
    const fn = auth.options.emailAndPassword?.sendResetPassword;
    expect(typeof fn).toBe("function");
    if (!fn) return;
    await fn({
      user: {
        id: "u1",
        email: "alice@example.com",
        name: "Alice",
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      url: "https://x/reset?t=1",
      token: "t1",
    });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      template: "password-reset",
      to: "alice@example.com",
    });
  });

  it("fires the welcome template via afterEmailVerification", async () => {
    const sender = fakeSender();
    const auth = buildBetterAuth({
      secret: "a".repeat(32),
      baseUrl: "http://localhost:3000",
      sessionExpiresInSeconds: 60,
      emailHooks: { sender, appName: "Acme" },
    });
    const fn = auth.options.emailVerification?.afterEmailVerification;
    expect(typeof fn).toBe("function");
    if (!fn) return;
    await fn({
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      template: "welcome",
      to: "alice@example.com",
    });
  });
});
