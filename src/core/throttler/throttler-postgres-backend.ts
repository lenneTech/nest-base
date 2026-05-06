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

export interface ThrottlerRecord {
  key: string;
  count: number;
  expiresAt: Date;
}

interface ThrottlerRecordRow {
  key: string;
  count: number | bigint;
  expires_at: Date;
}

/**
 * List active (non-expired) throttler records.
 *
 * Used by the `/admin/rate-limits/inspector.json` endpoint so operators can
 * see live throttle state without a DB console.
 */
export async function listActiveThrottlerRecords(
  prisma: PrismaThrottlerClient,
  opts: { now: Date; limit: number; offset?: number },
): Promise<{ rows: ThrottlerRecord[]; total: number }> {
  const isoNow = opts.now.toISOString();
  const offset = opts.offset ?? 0;
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT "key", "count", "expires_at" FROM "throttler_records" WHERE "expires_at" > $1 ORDER BY "expires_at" ASC LIMIT $2 OFFSET $3`,
    isoNow,
    opts.limit,
    offset,
  )) as ThrottlerRecordRow[];

  const countResult = (await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS "total" FROM "throttler_records" WHERE "expires_at" > $1`,
    isoNow,
  )) as Array<{ total: number }>;

  return {
    rows: rows.map((r) => ({ key: r.key, count: Number(r.count), expiresAt: r.expires_at })),
    total: countResult[0]?.total ?? 0,
  };
}

/**
 * List active throttler records with optional filters.
 */
export async function listFilteredThrottlerRecords(
  prisma: PrismaThrottlerClient,
  opts: { scope?: string; blockedOnly?: boolean; now: Date; limit: number },
): Promise<ThrottlerRecord[]> {
  const isoNow = opts.now.toISOString();
  // Build WHERE clauses dynamically — parameterised to prevent injection.
  const conditions: string[] = [`"expires_at" > $1`];
  const params: unknown[] = [isoNow];

  if (opts.scope) {
    params.push(`%${opts.scope}%`);
    conditions.push(`"key" ILIKE $${params.length}`);
  }

  const whereClause = conditions.join(" AND ");
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT "key", "count", "expires_at" FROM "throttler_records" WHERE ${whereClause} ORDER BY "expires_at" ASC LIMIT $${params.length + 1}`,
    ...params,
    opts.limit,
  )) as ThrottlerRecordRow[];

  const mapped = rows.map((r) => ({
    key: r.key,
    count: Number(r.count),
    expiresAt: r.expires_at,
  }));

  if (opts.blockedOnly) {
    // We can't filter by "blocked" at SQL level without knowing the per-scope limit;
    // the inspector will apply this filter after resolving the limit from config.
    return mapped;
  }
  return mapped;
}

/**
 * Delete a single throttler row by key (manually unblock a specific bucket).
 * Returns true if a row existed and was deleted.
 */
export async function resetThrottlerKey(
  prisma: PrismaThrottlerClient,
  key: string,
): Promise<boolean> {
  const result = (await prisma.$queryRawUnsafe(
    `DELETE FROM "throttler_records" WHERE "key" = $1 RETURNING "key"`,
    key,
  )) as Array<{ key: string }>;
  return result.length > 0;
}

/**
 * Delete all throttler rows whose key starts with `prefix`
 * (bulk-reset all windows for a given endpoint name).
 * Returns the count of deleted rows.
 */
export async function resetThrottlerByEndpointPrefix(
  prisma: PrismaThrottlerClient,
  prefix: string,
): Promise<number> {
  const result = (await prisma.$queryRawUnsafe(
    `DELETE FROM "throttler_records" WHERE "key" LIKE $1 RETURNING "key"`,
    `${prefix}%`,
  )) as Array<{ key: string }>;
  return result.length;
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
