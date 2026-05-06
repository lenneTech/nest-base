/**
 * API key expiry notifier — pure planner (CF.AUTH.17).
 *
 * Given a list of API keys with their expiry timestamps + last-
 * notified watermark, decides which keys should receive a "your
 * key expires in N days" notification email right now.
 *
 * The runner (a scheduled job using `@ScheduledJob` from iter-31)
 * walks the planner's output, sends one email per notification, and
 * updates the `lastNotifiedAt` field on each notified key.
 *
 * Why a planner: keeps the notification policy testable without
 * Postgres + email transport. The runner is a thin glue layer.
 *
 * Window semantics:
 *   - `warnWithinMs` — how far ahead of expiry to start warning
 *     (e.g. 7 days = `7 * 24 * 60 * 60 * 1000`).
 *   - `notifyCooldownMs` — minimum gap between repeated
 *     notifications for the same key (typically a day so we don't
 *     spam users on every cron tick).
 *
 * Excluded from notification:
 *   - Already-expired keys (warning window is past).
 *   - Keys without `expiresAt` (never-expire).
 *   - Keys notified within the cooldown.
 */

export interface ApiKeyExpiryRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: number | null;
  /** Wall-clock ms epoch of last notification, if any. */
  readonly lastNotifiedAt?: number | null;
}

export interface ExpiryNotifierInput {
  readonly keys: readonly ApiKeyExpiryRecord[];
  /** Notify when key's expiry falls within this many ms from now. */
  readonly warnWithinMs: number;
  /** Minimum gap between re-notifications for the same key. */
  readonly notifyCooldownMs: number;
  /** Injectable clock for deterministic tests. */
  readonly clock?: () => number;
}

export interface ExpiryNotification {
  readonly keyId: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly daysUntilExpiry: number;
}

export interface ExpiryNotifierResult {
  readonly notifications: readonly ExpiryNotification[];
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function planExpiryNotifications(input: ExpiryNotifierInput): ExpiryNotifierResult {
  const now = (input.clock ?? Date.now)();
  const warnDeadline = now + input.warnWithinMs;
  const notifications: ExpiryNotification[] = [];

  for (const key of input.keys) {
    if (key.expiresAt == null) continue;
    if (key.expiresAt <= now) continue;
    if (key.expiresAt > warnDeadline) continue;

    if (key.lastNotifiedAt != null && now - key.lastNotifiedAt < input.notifyCooldownMs) {
      continue;
    }

    const msUntilExpiry = key.expiresAt - now;
    const daysUntilExpiry = Math.floor(msUntilExpiry / ONE_DAY_MS);

    notifications.push({
      keyId: key.id,
      userId: key.userId,
      expiresAt: key.expiresAt,
      daysUntilExpiry,
    });
  }

  return { notifications };
}
