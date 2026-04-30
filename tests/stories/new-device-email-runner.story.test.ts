import { describe, expect, it } from "vitest";

import {
  createEmailHookRunner,
  type EmailSenderForHooks,
} from "../../src/core/auth/better-auth-email-hooks.runner.js";
import {
  createNewDeviceThrottle,
  type NewDeviceThrottle,
} from "../../src/core/devices/new-device-throttle.js";

/**
 * Story · Better-Auth hook runner — new-device dispatch + throttle.
 *
 * The runner gains a `sendNewDevice(data)` method. Two contracts:
 *
 *  1. The dispatch carries `mode: "outbox"` (when `useOutbox: true`)
 *     and a deterministic idempotency-key derived from the user-id +
 *     fingerprint, so a sign-in retried within a few seconds collapses
 *     to one outbox row.
 *
 *  2. A *throttle* sits in front: max 1 new-device mail per user per
 *     hour. Hands rotating mobile IPs / aggressive auto-relogin clients
 *     a sane upper bound on email volume. The throttle is an
 *     EmailRateLimiter-shaped object, injected so tests can poke a
 *     deterministic clock.
 */
describe("Story · Better-Auth hook runner new-device dispatch", () => {
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

  function fakeThrottle(): NewDeviceThrottle & { records: string[] } {
    const records: string[] = [];
    const allowed = new Set<string>();
    return {
      records,
      check(userId: string) {
        if (allowed.has(userId)) return { allowed: true };
        return { allowed: false, resetMs: 1_800_000 };
      },
      record(userId: string) {
        records.push(userId);
        allowed.delete(userId);
      },
      __allow(userId: string) {
        allowed.add(userId);
      },
    } as NewDeviceThrottle & { records: string[]; __allow: (id: string) => void };
  }

  const user = { id: "u1", email: "alice@example.com", name: "Alice" };
  const baseData = {
    user,
    deviceLabel: "Chrome on macOS",
    location: "Berlin, Germany",
    ipAddress: "203.0.113.42",
    signedInAt: "2026-04-30T10:00:00.000Z",
    revokeUrl: "https://app.example.com/me/devices",
  };

  it("queues the new-device mail with a deterministic idempotency-key", async () => {
    const sender = recordingSender();
    const throttle = fakeThrottle();
    (throttle as unknown as { __allow: (id: string) => void }).__allow("u1");
    const runner = createEmailHookRunner({
      sender,
      appName: "Acme",
      useOutbox: true,
      newDeviceThrottle: throttle,
    });
    await runner.sendNewDevice({ ...baseData, fingerprint: "fp-abc" });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]?.dispatch?.mode).toBe("outbox");
    // Key segments the namespace by kind + recipient + fingerprint
    // so a duplicate sign-in (same fp, same user) within the same
    // outbox window dedups. A fresh fingerprint produces a fresh key.
    expect(sender.calls[0]?.dispatch?.idempotencyKey).toContain("new-device");
    expect(sender.calls[0]?.dispatch?.idempotencyKey).toContain("fp-abc");
  });

  it("skips dispatch when the throttle denies (rate-limited)", async () => {
    const sender = recordingSender();
    const throttle = fakeThrottle(); // denies everyone by default
    const runner = createEmailHookRunner({
      sender,
      appName: "Acme",
      useOutbox: true,
      newDeviceThrottle: throttle,
    });
    await runner.sendNewDevice({ ...baseData, fingerprint: "fp-x" });
    expect(sender.calls).toHaveLength(0);
    // The throttle is record-on-success; a denied call must not
    // record (otherwise rejection would extend the window).
    expect(throttle.records).toHaveLength(0);
  });

  it("records the throttle slot only after a successful send", async () => {
    const sender = recordingSender();
    const throttle = fakeThrottle();
    (throttle as unknown as { __allow: (id: string) => void }).__allow("u1");
    const runner = createEmailHookRunner({
      sender,
      appName: "Acme",
      useOutbox: true,
      newDeviceThrottle: throttle,
    });
    await runner.sendNewDevice({ ...baseData, fingerprint: "fp-x" });
    expect(throttle.records).toEqual(["u1"]);
  });

  it("dispatches without throttle when none is configured", async () => {
    // Defensive default: a runner without a throttle still works
    // — useful for unit tests / project setups that want their own
    // rate-limiter wired upstream.
    const sender = recordingSender();
    const runner = createEmailHookRunner({
      sender,
      appName: "Acme",
      useOutbox: true,
    });
    await runner.sendNewDevice({ ...baseData, fingerprint: "fp-x" });
    expect(sender.calls).toHaveLength(1);
  });
});

describe("Story · new-device throttle", () => {
  it("allows the first call and denies the second within the window", () => {
    const now = { value: 0 };
    const throttle = createNewDeviceThrottle({
      windowMs: 60 * 60 * 1000, // 1h
      now: () => now.value,
    });
    const first = throttle.check("u1");
    expect(first.allowed).toBe(true);
    throttle.record("u1");
    const second = throttle.check("u1");
    expect(second.allowed).toBe(false);
    expect(second.resetMs).toBeGreaterThan(0);
  });

  it("re-allows after the window expires", () => {
    const now = { value: 0 };
    const throttle = createNewDeviceThrottle({
      windowMs: 1_000,
      now: () => now.value,
    });
    throttle.record("u1");
    expect(throttle.check("u1").allowed).toBe(false);
    now.value = 2_000;
    expect(throttle.check("u1").allowed).toBe(true);
  });

  it("partitions by user-id so two users don't share the window", () => {
    const now = { value: 0 };
    const throttle = createNewDeviceThrottle({
      windowMs: 60_000,
      now: () => now.value,
    });
    throttle.record("u1");
    expect(throttle.check("u1").allowed).toBe(false);
    expect(throttle.check("u2").allowed).toBe(true);
  });
});
