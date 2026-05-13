/**
 * Redis-backed email recipient rate limiter.
 *
 * Replaces the per-pod LRU `Map<string, RecipientRecord>` in
 * `RecipientRateLimiter` with a Redis sliding-window counter so the
 * per-recipient cap is enforced across all replicas.
 *
 * Algorithm: INCR + PEXPIRE on each message. The counter key holds
 * the send count for the current window. Because INCR is atomic,
 * concurrent replicas can't race.
 *
 * When `redis === null`, falls back to the original in-memory
 * LRU Map behaviour.
 *
 * The async interface differs from `RecipientRateLimiter.consume()`
 * which is synchronous — this adapter returns a Promise so callers
 * must await the decision.
 */

import type { RedisClientLike } from "./redis-client.js";
import type { RecipientRateLimitDecision } from "../email/recipient-rate-limiter.js";
import { RecipientRateLimiter } from "../email/recipient-rate-limiter.js";

export interface RedisRecipientRateLimiterConfig {
  redis: RedisClientLike | null;
  /** Max messages per recipient per `windowMs`. `0` disables the limiter. */
  limit: number;
  /** Sliding-window length in milliseconds. */
  windowMs: number;
  /** Injectable clock for deterministic tests. */
  clock?: () => number;
}

export interface AsyncRecipientRateLimiter {
  consume(email: string): Promise<RecipientRateLimitDecision>;
  status(email: string): Promise<{ count: number; allowed: boolean }>;
}

const KEY_PREFIX = "lt:rrl:";

/**
 * Factory — returns an `AsyncRecipientRateLimiter` backed by Redis when
 * available, falling back to an async wrapper around the synchronous
 * `RecipientRateLimiter` otherwise.
 */
export function createRedisRecipientRateLimiter(
  config: RedisRecipientRateLimiterConfig,
): AsyncRecipientRateLimiter {
  if (!config.redis) {
    return createInMemoryAsyncRateLimiter(config);
  }

  const { redis, limit, windowMs } = config;

  return {
    async consume(email: string): Promise<RecipientRateLimitDecision> {
      if (limit <= 0) return { allowed: true, count: 0, retryAt: 0 };
      try {
        const key = `${KEY_PREFIX}${email.trim().toLowerCase()}`;
        const count = await redis.incr(key);
        // Always refresh the TTL, not just on the first increment.
        // If the process crashes between INCR and PEXPIRE the key has no TTL
        // and the email address becomes permanently rate-limited. Setting the
        // TTL on every send self-heals leaked keys at the cost of resetting the
        // window with each message — acceptable for best-effort email throttling.
        await redis.pexpire(key, windowMs);
        if (count > limit) {
          // Approximate retryAt: windowMs from now (we don't store the
          // window start time in the counter, keeping the value simple).
          const retryAt = Date.now() + windowMs;
          return { allowed: false, count, retryAt };
        }
        return { allowed: true, count, retryAt: 0 };
      } catch {
        // Redis errors degrade to "allow" — don't block email delivery.
        return { allowed: true, count: 0, retryAt: 0 };
      }
    },

    async status(email: string): Promise<{ count: number; allowed: boolean }> {
      if (limit <= 0) return { count: 0, allowed: true };
      try {
        const key = `${KEY_PREFIX}${email.trim().toLowerCase()}`;
        const raw = await redis.get(key);
        const count = raw ? parseInt(raw, 10) : 0;
        return { count, allowed: count < limit };
      } catch {
        return { count: 0, allowed: true };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory fallback (wraps synchronous RecipientRateLimiter)
// ---------------------------------------------------------------------------

function createInMemoryAsyncRateLimiter(
  config: Omit<RedisRecipientRateLimiterConfig, "redis">,
): AsyncRecipientRateLimiter {
  const inner = new RecipientRateLimiter({
    limit: config.limit,
    windowMs: config.windowMs,
    maxEntries: 10_000,
    clock: config.clock,
  });

  return {
    async consume(email: string) {
      return inner.consume(email);
    },
    async status(email: string) {
      return inner.status(email);
    },
  };
}
