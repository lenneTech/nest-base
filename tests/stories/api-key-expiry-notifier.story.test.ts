import { describe, expect, it } from "vitest";

/**
 * Story · API key expiry notifier (CF.AUTH.17).
 *
 * The PRD's `CF.AUTH.17` requires a scheduled job that finds API
 * keys close to expiration and notifies their owners by email so
 * they can rotate before their integrations break.
 *
 * The planner is pure: given a list of keys + a "warn within N days"
 * threshold + a clock, it returns the subset that should receive a
 * notification right now (and which has not been notified for the
 * current expiry already — the `lastNotifiedAt` watermark prevents
 * re-notification storms).
 *
 * Notification windows:
 *   - Key expires within `warnWithinMs` from now → notify if not
 *     notified within `notifyCooldownMs` already.
 *   - Already-expired keys: not notified (irrelevant to "warn before
 *     expiry"; deletion is a separate concern).
 *   - Keys without `expiresAt` (never expire): not notified.
 */
describe("Story · API key expiry notifier planner", () => {
  it("flags keys that will expire within the warn window", async () => {
    const { planExpiryNotifications } =
      await import("../../src/core/auth/api-keys/api-key-expiry.notifier.js");
    const now = 1_000_000_000_000;
    const fiveDaysMs = 5 * 24 * 60 * 60 * 1000;

    const result = planExpiryNotifications({
      keys: [
        { id: "k1", userId: "u1", expiresAt: now + 3 * 24 * 60 * 60 * 1000 }, // 3 days
        { id: "k2", userId: "u2", expiresAt: now + 7 * 24 * 60 * 60 * 1000 }, // 7 days
      ],
      warnWithinMs: fiveDaysMs,
      notifyCooldownMs: 24 * 60 * 60 * 1000,
      clock: () => now,
    });

    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0]?.keyId).toBe("k1");
    expect(result.notifications[0]?.userId).toBe("u1");
  });

  it("ignores already-expired keys (they're past warning, not within)", async () => {
    const { planExpiryNotifications } =
      await import("../../src/core/auth/api-keys/api-key-expiry.notifier.js");
    const now = 1_000_000_000_000;
    const result = planExpiryNotifications({
      keys: [{ id: "k1", userId: "u1", expiresAt: now - 1000 }],
      warnWithinMs: 7 * 24 * 60 * 60 * 1000,
      notifyCooldownMs: 24 * 60 * 60 * 1000,
      clock: () => now,
    });
    expect(result.notifications).toHaveLength(0);
  });

  it("ignores keys without an expiresAt (never-expire)", async () => {
    const { planExpiryNotifications } =
      await import("../../src/core/auth/api-keys/api-key-expiry.notifier.js");
    const now = 1_000_000_000_000;
    const result = planExpiryNotifications({
      keys: [{ id: "k1", userId: "u1", expiresAt: null }],
      warnWithinMs: 7 * 24 * 60 * 60 * 1000,
      notifyCooldownMs: 24 * 60 * 60 * 1000,
      clock: () => now,
    });
    expect(result.notifications).toHaveLength(0);
  });

  it("respects the cooldown — does not re-notify if already notified recently", async () => {
    const { planExpiryNotifications } =
      await import("../../src/core/auth/api-keys/api-key-expiry.notifier.js");
    const now = 1_000_000_000_000;
    const result = planExpiryNotifications({
      keys: [
        {
          id: "k1",
          userId: "u1",
          expiresAt: now + 2 * 24 * 60 * 60 * 1000,
          lastNotifiedAt: now - 6 * 60 * 60 * 1000, // 6h ago
        },
      ],
      warnWithinMs: 7 * 24 * 60 * 60 * 1000,
      notifyCooldownMs: 24 * 60 * 60 * 1000, // 24h cooldown
      clock: () => now,
    });
    expect(result.notifications).toHaveLength(0);
  });

  it("re-notifies once the cooldown has elapsed", async () => {
    const { planExpiryNotifications } =
      await import("../../src/core/auth/api-keys/api-key-expiry.notifier.js");
    const now = 1_000_000_000_000;
    const result = planExpiryNotifications({
      keys: [
        {
          id: "k1",
          userId: "u1",
          expiresAt: now + 2 * 24 * 60 * 60 * 1000,
          lastNotifiedAt: now - 25 * 60 * 60 * 1000, // 25h ago
        },
      ],
      warnWithinMs: 7 * 24 * 60 * 60 * 1000,
      notifyCooldownMs: 24 * 60 * 60 * 1000,
      clock: () => now,
    });
    expect(result.notifications).toHaveLength(1);
  });

  it("includes the days-until-expiry field for the email template", async () => {
    const { planExpiryNotifications } =
      await import("../../src/core/auth/api-keys/api-key-expiry.notifier.js");
    const now = 1_000_000_000_000;
    const result = planExpiryNotifications({
      keys: [{ id: "k1", userId: "u1", expiresAt: now + 3 * 24 * 60 * 60 * 1000 }],
      warnWithinMs: 7 * 24 * 60 * 60 * 1000,
      notifyCooldownMs: 24 * 60 * 60 * 1000,
      clock: () => now,
    });
    expect(result.notifications[0]?.daysUntilExpiry).toBe(3);
  });

  it("handles multiple keys in one pass", async () => {
    const { planExpiryNotifications } =
      await import("../../src/core/auth/api-keys/api-key-expiry.notifier.js");
    const now = 1_000_000_000_000;
    const day = 24 * 60 * 60 * 1000;
    const result = planExpiryNotifications({
      keys: [
        { id: "k1", userId: "u1", expiresAt: now + 1 * day }, // notify
        { id: "k2", userId: "u2", expiresAt: now + 10 * day }, // outside window
        { id: "k3", userId: "u3", expiresAt: now - 1 * day }, // expired
        { id: "k4", userId: "u4", expiresAt: null }, // never-expire
        { id: "k5", userId: "u5", expiresAt: now + 4 * day }, // notify
      ],
      warnWithinMs: 7 * day,
      notifyCooldownMs: day,
      clock: () => now,
    });
    expect(result.notifications.map((n) => n.keyId).sort()).toEqual(["k1", "k5"]);
  });
});
