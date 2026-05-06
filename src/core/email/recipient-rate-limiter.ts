/**
 * Email per-recipient rate limiter (CF.EMAIL.11).
 *
 * Sliding-window counter, keyed by recipient email address. The
 * `EmailService` consults this before every transport.send() and
 * skips delivery (returning a `rate_limited`-style result) when the
 * recipient has hit the cap.
 *
 * Why a hand-rolled limiter instead of `@nestjs/throttler`: the
 * throttler module is request-scoped (decorator + guard); the email
 * limiter is service-scoped (a value the EmailService consults
 * directly). Sharing the throttler's storage would couple the email
 * subsystem to the global rate-limit feature flag — wrong direction.
 *
 * Storage is an in-memory LRU bounded by `maxEntries` so the
 * structure can't run out of memory under sustained traffic.
 * Multi-instance deployments under-throttle (each instance has its
 * own LRU); the cap is per-instance × N — acceptable for a
 * transactional-email rate guard whose primary job is to break
 * tight-loop bugs, not absorb a sophisticated abuser.
 *
 * Ported from nest-base-alternative — 2026-05-04 fusion iter-34
 */

interface RecipientRecord {
  /** Wall-clock timestamps of the messages observed inside the window. */
  readonly timestamps: number[];
}

export interface RecipientRateLimiterConfig {
  /** Max messages per recipient per `windowMs`. `0` disables the limiter. */
  readonly limit: number;
  /** Sliding-window length in milliseconds. */
  readonly windowMs: number;
  /** Max distinct addresses tracked. LRU evicts oldest beyond this. */
  readonly maxEntries: number;
  /** Injectable clock for deterministic tests. */
  readonly clock?: () => number;
}

const DEFAULT_MAX_ENTRIES = 10_000;

/**
 * Bounded LRU keyed by email address. Re-`set` on hit moves the
 * entry to most-recent.
 */
class LruMap<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, value);
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

export interface RecipientRateLimitDecision {
  /** `false` when the recipient is currently above the cap. */
  readonly allowed: boolean;
  /** How many messages the recipient has received in the current window. */
  readonly count: number;
  /** When the next slot frees up (ms epoch). 0 when allowed. */
  readonly retryAt: number;
}

export class RecipientRateLimiter {
  private readonly records: LruMap<string, RecipientRecord>;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly clock: () => number;

  constructor(config: RecipientRateLimiterConfig) {
    this.limit = config.limit;
    this.windowMs = config.windowMs;
    this.clock = config.clock ?? Date.now;
    this.records = new LruMap(config.maxEntries ?? DEFAULT_MAX_ENTRIES);
  }

  /**
   * Atomic "check + record" — when the recipient is under the cap
   * AND the limiter is enabled, the new send is recorded and
   * `allowed: true` is returned. When over the cap, no record is
   * added and `allowed: false` is returned with the wall-clock at
   * which the next slot frees up.
   *
   * `limit === 0` short-circuits to "always allowed" without
   * touching the LRU — keeps the disabled-feature footprint minimal.
   */
  consume(email: string): RecipientRateLimitDecision {
    if (this.limit <= 0) {
      return { allowed: true, count: 0, retryAt: 0 };
    }
    const key = normalize(email);
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const existing = this.records.get(key);
    const fresh = (existing?.timestamps ?? []).filter((t) => t > cutoff);
    if (fresh.length >= this.limit) {
      // Smallest timestamp tells us the window's leading edge — when
      // it ages out, capacity opens up.
      const oldest = fresh[0] ?? now;
      const retryAt = oldest + this.windowMs;
      this.records.set(key, { timestamps: fresh });
      return { allowed: false, count: fresh.length, retryAt };
    }
    fresh.push(now);
    this.records.set(key, { timestamps: fresh });
    return { allowed: true, count: fresh.length, retryAt: 0 };
  }

  /**
   * Inspect the recipient's window without recording a new message.
   * Useful for tests + admin tooling.
   */
  status(email: string): { count: number; allowed: boolean } {
    if (this.limit <= 0) return { count: 0, allowed: true };
    const key = normalize(email);
    const now = this.clock();
    const cutoff = now - this.windowMs;
    const fresh = (this.records.get(key)?.timestamps ?? []).filter((t) => t > cutoff);
    return { count: fresh.length, allowed: fresh.length < this.limit };
  }

  /** Test-only — drop every record. */
  reset(): void {
    this.records.clear();
  }
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}
