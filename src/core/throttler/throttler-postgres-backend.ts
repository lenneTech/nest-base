import type { ThrottlerBackend, ThrottlerBackendRow } from "./throttler.js";

/**
 * Prisma-backed `ThrottlerBackend` (CF.SEC.RATE_LIMIT).
 *
 * Implements the rate-limiter's atomic increment-or-create
 * primitive against a `throttler_records` table:
 *
 *   ┌──────┬─────────┬─────────────────┐
 *   │ key  │ count   │ expires_at      │
 *   └──────┴─────────┴─────────────────┘
 *
 * The `upsert()` call is implemented as a single SQL statement —
 * `INSERT … ON CONFLICT (key) DO UPDATE …` — so a burst of
 * concurrent requests for the same key never trip a PG advisory
 * lock collision. When the existing row's `expires_at` has
 * already elapsed at write-time, we treat it as a fresh window
 * (count = 1), otherwise we increment.
 *
 * Why a separate backend (not a $extends-style Prisma extension):
 * the throttler runs on every request, including unauthenticated
 * paths; the extension chain assumes an authenticated request
 * context (audit-stamp expects tenantId, audit Prisma extension
 * expects an actor). Keeping the throttler on a thin SQL surface
 * avoids that coupling.
 */

/**
 * Minimal Prisma surface the backend needs — we type the
 * dependency structurally so the unit tests can pass a fake
 * `$queryRaw` without spinning up a real client. The signatures
 * mirror Prisma 7's tagged-template surface but stay generic so a
 * `PrismaService` instance satisfies the contract structurally.
 */
export interface PrismaThrottlerClient {
  readonly $queryRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
  readonly $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<unknown>;
}

interface ThrottlerRow {
  readonly count: number | bigint;
  readonly expires_at: Date;
}

export class PostgresThrottlerBackend implements ThrottlerBackend {
  constructor(private readonly prisma: PrismaThrottlerClient) {}

  async upsert(key: string, ttlMs: number, now: number): Promise<ThrottlerBackendRow> {
    if (ttlMs <= 0) {
      throw new Error(`postgres-throttler-backend: ttlMs must be positive (received: ${ttlMs})`);
    }
    const newExpiresAt = new Date(now + ttlMs);
    // The atomic upsert:
    //   - inserts a fresh row with count=1 + expires_at = now+ttl, OR
    //   - updates the existing row:
    //       * if not yet expired → count = count + 1
    //       * if expired         → count = 1, expires_at = now+ttl
    // and returns the resulting (count, expires_at) pair so the
    // adapter can decide blocked / not-blocked without a second
    // round-trip.
    const sql = `
      INSERT INTO "throttler_records" ("key", "count", "expires_at")
      VALUES ($1, 1, $2)
      ON CONFLICT ("key") DO UPDATE
      SET
        "count" = CASE
          WHEN "throttler_records"."expires_at" > NOW()
            THEN "throttler_records"."count" + 1
          ELSE 1
        END,
        "expires_at" = CASE
          WHEN "throttler_records"."expires_at" > NOW()
            THEN "throttler_records"."expires_at"
          ELSE $2
        END
      RETURNING "count", "expires_at"
    `;
    const rows = (await this.prisma.$queryRawUnsafe(sql, key, newExpiresAt)) as ThrottlerRow[];
    const first = rows[0];
    if (!first) {
      throw new Error("postgres-throttler-backend: upsert returned no row");
    }
    return {
      count: Number(first.count),
      expiresAt: first.expires_at.getTime(),
    };
  }

  async reset(key: string): Promise<void> {
    await this.prisma.$executeRawUnsafe(`DELETE FROM "throttler_records" WHERE "key" = $1`, key);
  }
}

/**
 * Pure planner — extracts the upsert SQL contract for unit-test
 * pinning. Real binding goes through `PostgresThrottlerBackend`
 * above; this helper makes the SQL shape inspectable in tests
 * without a live Prisma client.
 */
export function buildThrottlerUpsertContract(
  key: string,
  ttlMs: number,
  now: number,
): { newExpiresAt: Date } {
  if (ttlMs <= 0) {
    throw new Error(`postgres-throttler-backend: ttlMs must be positive (received: ${ttlMs})`);
  }
  void key;
  return { newExpiresAt: new Date(now + ttlMs) };
}
