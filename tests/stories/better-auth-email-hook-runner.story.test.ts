import { describe, expect, it, vi } from "vitest";

import {
  createEmailHookRunner,
  type EmailSenderForHooks,
} from "../../src/core/auth/better-auth-email-hooks.runner.js";

/**
 * Story · Better-Auth email hook runner.
 *
 * The runner is the thin glue that:
 *  1. translates a Better-Auth hook payload (planner-side) and
 *  2. calls the injected `EmailService`-shaped sender, swallowing
 *     errors so a transient SMTP outage never blocks the auth flow.
 *
 * Errors are logged via the supplied `onError` hook so operators see
 * them — they MUST NOT propagate. Better-Auth retries on its own; the
 * outbox slice (issue #11) will add at-least-once durability later.
 */
describe("Story · Better-Auth email hook runner", () => {
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

  function failingSender(message: string): EmailSenderForHooks {
    return {
      async sendTemplate() {
        throw new Error(message);
      },
    };
  }

  const user = { id: "u1", email: "alice@example.com", name: "Alice" };
  const appName = "Acme";

  it("sendVerificationEmail() forwards to the email-verification template", async () => {
    const sender = fakeSender();
    const runner = createEmailHookRunner({ sender, appName });
    await runner.sendVerificationEmail({
      user,
      url: "https://x/verify?t=1",
      token: "t1",
    });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      template: "email-verification",
      to: "alice@example.com",
      vars: {
        recipientName: "Alice",
        appName: "Acme",
        verificationUrl: "https://x/verify?t=1",
      },
    });
  });

  it("sendResetPassword() forwards to the password-reset template", async () => {
    const sender = fakeSender();
    const runner = createEmailHookRunner({ sender, appName });
    await runner.sendResetPassword({
      user,
      url: "https://x/reset?t=1",
      token: "t1",
    });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      template: "password-reset",
      to: "alice@example.com",
      vars: {
        recipientName: "Alice",
        appName: "Acme",
        resetUrl: "https://x/reset?t=1",
      },
    });
  });

  it("sendWelcome() forwards to the welcome template", async () => {
    const sender = fakeSender();
    const runner = createEmailHookRunner({ sender, appName });
    await runner.sendWelcome({ user });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      template: "welcome",
      to: "alice@example.com",
      vars: { recipientName: "Alice", appName: "Acme" },
    });
  });

  it("sendInvitation() forwards to the invitation template", async () => {
    const sender = fakeSender();
    const runner = createEmailHookRunner({ sender, appName });
    await runner.sendInvitation({
      user,
      url: "https://x/accept?t=1",
      senderName: "Bob",
    });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]).toMatchObject({
      template: "invitation",
      to: "alice@example.com",
      vars: {
        recipientName: "Alice",
        appName: "Acme",
        acceptUrl: "https://x/accept?t=1",
        senderName: "Bob",
      },
    });
  });

  it("does NOT propagate sender errors back to the auth flow", async () => {
    const sender = failingSender("smtp boom");
    const onError = vi.fn();
    const runner = createEmailHookRunner({ sender, appName, onError });
    // Returning resolved void is the whole contract: Better-Auth keeps
    // running, the user-facing flow stays unblocked.
    await expect(
      runner.sendVerificationEmail({ user, url: "https://x/y", token: "t" }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    // Context arg lets operators correlate the failure with the flow.
    expect(onError.mock.calls[0]?.[1]).toMatchObject({ template: "email-verification" });
  });

  it("does NOT propagate planner errors either (e.g. bad operator config)", async () => {
    // Empty appName trips the planner — the runner still resolves void.
    const sender = fakeSender();
    const onError = vi.fn();
    const runner = createEmailHookRunner({ sender, appName: "", onError });
    await expect(
      runner.sendVerificationEmail({ user, url: "https://x/y", token: "t" }),
    ).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
    expect(sender.calls).toHaveLength(0);
  });

  it("logs failures via the default logger when onError is omitted", async () => {
    const sender = failingSender("smtp down");
    const runner = createEmailHookRunner({ sender, appName });
    // No onError → default Logger.error path. Just assert the void
    // resolution; the logger is a side-effect tested at import time.
    await expect(
      runner.sendResetPassword({ user, url: "https://x/y", token: "t" }),
    ).resolves.toBeUndefined();
  });
});
