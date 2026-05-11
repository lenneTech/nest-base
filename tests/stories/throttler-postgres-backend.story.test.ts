import { describe, expect, it } from "vitest";

import {
  PostgresThrottlerBackend,
  type PrismaThrottlerClient,
  buildThrottlerUpsertContract,
  listFilteredThrottlerRecords,
} from "../../src/core/throttler/throttler-postgres-backend.js";

/**
 * Story · Postgres throttler backend (CF.SEC.RATE_LIMIT).
 *
 * The PRD requires the rate-limiter to persist windows across
 * NestJS instances. The default in-memory storage scopes per
 * process — a horizontally-scaled deployment with two pods would
 * let users double the limit by sticky-session-ing across them.
 *
 * The Postgres backend implements the `ThrottlerBackend.upsert()`
 * contract via a single SQL `INSERT ... ON CONFLICT ... DO UPDATE
 * ... RETURNING` so concurrent requests for the same key can't
 * race, regardless of which pod they hit.
 *
 * The story tests pin the contract via a fake $queryRawUnsafe that
 * captures the SQL + bind values; the live integration test (when
 * the throttler-records migration lands in CI) lives in
 * `tests/throttler-postgres.e2e-spec.ts`.
 */
describe("Story · PostgresThrottlerBackend", () => {
  it("issues an upsert SQL with key + expiresAt bound + returns the row", async () => {
    const captured: { sql: string; values: unknown[] } | null = null;
    let invoked: { sql: string; values: unknown[] } | null = captured;
    const client: PrismaThrottlerClient = {
      $queryRawUnsafe: async (sql, ...values) => {
        invoked = { sql, values };
        return [{ count: 3, expires_at: new Date("2026-05-04T16:00:00Z") }];
      },
      $executeRawUnsafe: async () => 0,
    };
    const backend = new PostgresThrottlerBackend(client);
    const row = await backend.upsert("k:user-1", 60_000, Date.parse("2026-05-04T15:59:30Z"));
    expect(row.count).toBe(3);
    expect(row.expiresAt).toBe(Date.parse("2026-05-04T16:00:00Z"));
    expect(invoked).not.toBeNull();
    expect(invoked!.sql).toMatch(/INSERT INTO\s+"throttler_records"/);
    expect(invoked!.sql).toMatch(/ON CONFLICT\s*\(\s*"key"\s*\)/);
    expect(invoked!.sql).toMatch(/RETURNING\s+"count"\s*,\s*"expires_at"/);
    expect(invoked!.values[0]).toBe("k:user-1");
    expect(invoked!.values[1]).toBeInstanceOf(Date);
  });

  it("rejects non-positive ttlMs (defensive guard)", async () => {
    const client: PrismaThrottlerClient = {
      $queryRawUnsafe: async () => [],
      $executeRawUnsafe: async () => 0,
    };
    const backend = new PostgresThrottlerBackend(client);
    await expect(backend.upsert("k", 0, Date.now())).rejects.toThrow(/ttlMs must be positive/);
    await expect(backend.upsert("k", -1, Date.now())).rejects.toThrow(/ttlMs must be positive/);
  });

  it("converts the returned bigint count to a number", async () => {
    const client: PrismaThrottlerClient = {
      $queryRawUnsafe: async () => [{ count: 42n, expires_at: new Date(0) }],
      $executeRawUnsafe: async () => 0,
    };
    const backend = new PostgresThrottlerBackend(client);
    const row = await backend.upsert("k", 1000, Date.now());
    expect(row.count).toBe(42);
    expect(typeof row.count).toBe("number");
  });

  it("throws when the upsert returns no row (corruption signal)", async () => {
    const client: PrismaThrottlerClient = {
      $queryRawUnsafe: async () => [],
      $executeRawUnsafe: async () => 0,
    };
    const backend = new PostgresThrottlerBackend(client);
    await expect(backend.upsert("k", 1000, Date.now())).rejects.toThrow(/upsert returned no row/);
  });

  it("reset() issues a DELETE WHERE key = $1", async () => {
    let invoked: { sql: string; values: unknown[] } | null = null;
    const client: PrismaThrottlerClient = {
      $queryRawUnsafe: async () => [],
      $executeRawUnsafe: async (sql, ...values) => {
        invoked = { sql, values };
        return 1;
      },
    };
    const backend = new PostgresThrottlerBackend(client);
    await backend.reset("k:user-1");
    expect(invoked).not.toBeNull();
    expect(invoked!.sql).toMatch(/DELETE\s+FROM\s+"throttler_records"/);
    expect(invoked!.sql).toMatch(/WHERE\s+"key"\s*=\s*\$1/);
    expect(invoked!.values).toEqual(["k:user-1"]);
  });

  describe("buildThrottlerUpsertContract", () => {
    it("computes newExpiresAt = now + ttlMs", () => {
      const contract = buildThrottlerUpsertContract("k", 60_000, 1_000_000);
      expect(contract.newExpiresAt.getTime()).toBe(1_060_000);
    });

    it("rejects non-positive ttlMs", () => {
      expect(() => buildThrottlerUpsertContract("k", 0, 1)).toThrow(/ttlMs must be positive/);
    });
  });

  describe("listFilteredThrottlerRecords — M5 regression guard", () => {
    it("returns records filtered by scope without blockedOnly parameter", async () => {
      const now = new Date();
      const future = new Date(Date.now() + 60_000);
      const client: PrismaThrottlerClient = {
        $queryRawUnsafe: async () => [
          { key: "api:user-1", count: 5, expires_at: future },
          { key: "api:user-2", count: 2, expires_at: future },
        ],
        $executeRawUnsafe: async () => 0,
      };
      const rows = await listFilteredThrottlerRecords(client, { scope: "api", now, limit: 50 });
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ key: "api:user-1", count: 5 });
    });

    it("function signature does not accept blockedOnly — dead branch is removed", () => {
      // Type-level guard: the parameter object has no blockedOnly key.
      // If blockedOnly is re-added accidentally this compile-test catches it.
      const opts: Parameters<typeof listFilteredThrottlerRecords>[1] = {
        now: new Date(),
        limit: 10,
      };
      // @ts-expect-error blockedOnly is not a valid key after M5 fix
      const _bad = { ...opts, blockedOnly: true };
      expect(opts).not.toHaveProperty("blockedOnly");
    });
  });

  describe("migration", () => {
    it("the throttler_records migration ships with the expected schema shape", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const sql = readFileSync(
        resolve(__dirname, "..", "..", "prisma/migrations/20260508000000_init/migration.sql"),
        "utf8",
      );
      // The squashed init uses schema-qualified names: CREATE TABLE "public"."throttler_records"
      expect(sql).toMatch(/CREATE TABLE\s+(?:"public"\.)?"throttler_records"/);
      expect(sql).toMatch(/"key"\s+TEXT\s+NOT NULL/);
      expect(sql).toMatch(/"count"\s+INTEGER\s+NOT NULL/);
      expect(sql).toMatch(/"expires_at"\s+TIMESTAMP\(3\)\s+NOT NULL/);
      expect(sql).toMatch(/PRIMARY KEY\s*\(\s*"key"\s*\)/);
      expect(sql).toMatch(/CREATE INDEX\s+"throttler_records_expires_at_idx"/);
    });
  });
});
