/**
 * Throttler — Postgres-backed multi-window rate limiter
 * (PLAN.md §32 Phase 8 + §28.6 row).
 *
 * Two pieces:
 *
 *   1. `PostgresThrottlerStore` — @nestjs/throttler-compatible
 *      storage adapter. Wraps a `ThrottlerBackend` whose Postgres
 *      implementation lives in the persistence layer (a thin SQL
 *      `INSERT … ON CONFLICT … RETURNING` over a `(key, count,
 *      expires_at)` row). Tests use an in-memory backend with the
 *      same shape so the suite stays DB-free.
 *
 *   2. `ThrottlerService.consume(input)` — multi-window decision.
 *      The PLAN mandates 1s / 1min / 1h windows; a request is denied
 *      the moment ANY window goes over its limit. The first
 *      violating window in input order is the one reported back
 *      (ordering = priority — the most restrictive should be first).
 */

export interface ThrottlerBackendRow {
  count: number;
  expiresAt: number;
}

export interface ThrottlerBackend {
  /** Increment-or-create the row at `key`. Implementations are responsible for atomicity. */
  upsert(key: string, ttlMs: number, now: number): Promise<ThrottlerBackendRow>;
  reset(key: string): Promise<void>;
}

export interface ThrottlerStorageRecord {
  totalHits: number;
  /** Seconds remaining in the window. */
  timeToExpire: number;
  isBlocked: boolean;
  /** Seconds remaining in the block; mirrors timeToExpire here (single-window adapter call). */
  timeToBlockExpire: number;
}

export interface ThrottlerStorage {
  increment(
    key: string,
    ttlMs: number,
    limit: number,
    now: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord>;
}

/**
 * Adapter that turns a key/count/expiresAt backend into the shape
 * `@nestjs/throttler` expects via its `ThrottlerStorage` interface.
 */
export class PostgresThrottlerStore implements ThrottlerStorage {
  constructor(private readonly backend: ThrottlerBackend) {}

  async increment(
    key: string,
    ttlMs: number,
    limit: number,
    now: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const row = await this.backend.upsert(key, ttlMs, now);
    const timeToExpire = Math.max(0, Math.floor((row.expiresAt - now) / 1000));
    const isBlocked = row.count > limit;
    return {
      totalHits: row.count,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: timeToExpire,
    };
  }
}

export interface ThrottleWindow {
  name: string;
  limit: number;
  ttlMs: number;
}

export interface ConsumeInput {
  key: string;
  windows: ThrottleWindow[];
}

export interface ConsumeResult {
  allowed: boolean;
  violatedWindow?: string;
  /** Per-window state, ordered as the input was. */
  windows: Array<{ name: string; remaining: number; resetSeconds: number }>;
}

export interface ThrottlerServiceOptions {
  now: () => number;
}

export class ThrottlerService {
  constructor(
    private readonly storage: ThrottlerStorage,
    private readonly options: ThrottlerServiceOptions,
  ) {}

  async consume(input: ConsumeInput): Promise<ConsumeResult> {
    if (input.windows.length === 0) {
      throw new Error("throttler: windows array must contain at least one entry");
    }
    const now = this.options.now();
    const states: ConsumeResult["windows"] = [];
    let violatedWindow: string | undefined;

    for (const window of input.windows) {
      const compositeKey = `${input.key}::${window.name}`;
      const record = await this.storage.increment(
        compositeKey,
        window.ttlMs,
        window.limit,
        now,
        window.name,
      );
      states.push({
        name: window.name,
        remaining: Math.max(0, window.limit - record.totalHits),
        resetSeconds: record.timeToExpire,
      });
      if (!violatedWindow && record.isBlocked) {
        violatedWindow = window.name;
      }
    }

    return {
      allowed: violatedWindow === undefined,
      violatedWindow,
      windows: states,
    };
  }
}
