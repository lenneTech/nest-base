import { describe, expect, it } from "vitest";

import {
  createEmailHookRunner,
  type EmailSenderForHooks,
} from "../../src/core/auth/better-auth-email-hooks.runner.js";

/**
 * Story · Better-Auth hook runner uses outbox mode.
 *
 * Issue #11 acceptance: hooks must enqueue mail via the email-outbox
 * (mode: "outbox" + an idempotency-key derived from the hook
 * payload) so a server crash between trigger and SMTP-ACK never
 * loses verification / reset mails. The runner surface stays
 * unchanged; the second arg flowing into sender.sendTemplate is the
 * SendDispatchOptions object EmailService accepts.
 */
describe("Story · Better-Auth hook runner outbox dispatch", () => {
  function recordingSender(): EmailSenderForHooks & {
    calls: Array<{
      template: string;
      to: string;
      vars: object;
      dispatch?: { mode?: string; idempotencyKey?: string };
    }>;
  } {
    const calls: Array<{
      template: string;
      to: string;
      vars: object;
      dispatch?: { mode?: string; idempotencyKey?: string };
    }> = [];
    return {
      calls,
      async sendTemplate(args, dispatch) {
        calls.push({
          template: args.template,
          to: args.to,
          vars: args.vars ?? {},
          ...(dispatch ? { dispatch } : {}),
        });
        return { messageId: `m-${calls.length}`, driver: "outbox" };
      },
    };
  }

  const user = { id: "u1", email: "alice@example.com", name: "Alice" };
  const appName = "Acme";

  it("forwards mode: 'outbox' + a stable idempotencyKey for verification mails", async () => {
    const sender = recordingSender();
    const runner = createEmailHookRunner({ sender, appName, useOutbox: true });
    await runner.sendVerificationEmail({
      user,
      url: "https://x/verify?t=tok-123",
      token: "tok-123",
    });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.dispatch?.mode).toBe("outbox");
    expect(sender.calls[0]?.dispatch?.idempotencyKey).toBeDefined();
    // Two enqueues with the same payload share the same key — that's
    // the dedup contract for "user clicks Resend twice".
    await runner.sendVerificationEmail({
      user,
      url: "https://x/verify?t=tok-123",
      token: "tok-123",
    });
    expect(sender.calls[1]?.dispatch?.idempotencyKey).toBe(
      sender.calls[0]?.dispatch?.idempotencyKey,
    );
  });

  it("derives idempotency-keys for password-reset mails from the token", async () => {
    const sender = recordingSender();
    const runner = createEmailHookRunner({ sender, appName, useOutbox: true });
    await runner.sendResetPassword({
      user,
      url: "https://x/reset?t=reset-1",
      token: "reset-1",
    });
    expect(sender.calls[0]?.dispatch?.idempotencyKey).toContain("password-reset");
    expect(sender.calls[0]?.dispatch?.idempotencyKey).toContain("reset-1");
  });

  it("welcome mails get a per-user key (no token in the payload)", async () => {
    const sender = recordingSender();
    const runner = createEmailHookRunner({ sender, appName, useOutbox: true });
    await runner.sendWelcome({ user });
    expect(sender.calls[0]?.dispatch?.idempotencyKey).toContain("welcome");
    expect(sender.calls[0]?.dispatch?.idempotencyKey).toContain(user.id);
  });

  it("default mode (useOutbox: false) sends synchronously without dispatch options", async () => {
    const sender = recordingSender();
    const runner = createEmailHookRunner({ sender, appName });
    await runner.sendVerificationEmail({
      user,
      url: "https://x/verify",
      token: "t1",
    });
    expect(sender.calls[0]?.dispatch).toBeUndefined();
  });
});
