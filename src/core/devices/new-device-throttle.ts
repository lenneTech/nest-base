/**
 * New-device email throttle.
 *
 * Issue #13 caps new-device mails at 1 per user per hour. Mobile
 * devices roam IPs aggressively (cellular ↔ wifi) — without this
 * cap a user with a flaky connection can produce a fresh fingerprint
 * every few minutes and get spammed with notifications.
 *
 * In-memory implementation — fits a single-instance Nest deploy.
 * For multi-instance deploys, swap the storage with a Redis-backed
 * implementation (same interface, different backing). The interface
 * intentionally mirrors `EmailRateLimiter` so callers can pick
 * either.
 */

export interface NewDeviceThrottleDecision {
  allowed: boolean;
  /** Milliseconds until the next allowed call, when denied. */
  resetMs?: number;
}

export interface NewDeviceThrottle {
  check(userId: string): NewDeviceThrottleDecision;
  record(userId: string): void;
}

export interface CreateNewDeviceThrottleOptions {
  /** Window in milliseconds; default 1h. */
  windowMs?: number;
  /** Clock injection — tests pass a deterministic value. */
  now?: () => number;
}

const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

export function createNewDeviceThrottle(
  options: CreateNewDeviceThrottleOptions = {},
): NewDeviceThrottle {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const now = options.now ?? (() => Date.now());
  const lastSent = new Map<string, number>();

  return {
    check(userId: string): NewDeviceThrottleDecision {
      const last = lastSent.get(userId);
      if (last === undefined) return { allowed: true };
      const elapsed = now() - last;
      if (elapsed >= windowMs) {
        // Window has elapsed — clean up the stale entry so the map
        // doesn't grow unbounded for users that sign in once and
        // never come back.
        lastSent.delete(userId);
        return { allowed: true };
      }
      return { allowed: false, resetMs: windowMs - elapsed };
    },
    record(userId: string): void {
      lastSent.set(userId, now());
    },
  };
}
