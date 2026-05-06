import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ThrottlerCleanupCron } from "../src/core/throttler/throttler-cleanup.js";
import type { PrismaService } from "../src/core/prisma/prisma.service.js";

/**
 * E2E · `ThrottlerCleanupCron` against real Postgres (iter-198).
 *
 * Iter-77 migration `20260504160000_throttler_records/migration.sql`
 * documented "a periodic background sweep deletes rows whose
 * `expires_at < now() - INTERVAL '1 day'` ... default cadence is 1 hour"
 * but no cron was wired. Iter-198 added the `ThrottlerCleanupCron` +
 * registered it as a provider in `AppModule`. This e2e proves the
 * cron's SQL DELETE actually runs against the live `throttler_records`
 * table + probes the matching `throttler_records_expires_at_idx`
 * index that backs the prune.
 */
describe("E2E · ThrottlerCleanupCron prunes stale throttler_records from real Postgres", () => {
  let prisma: PrismaClient;
  let cron: ThrottlerCleanupCron;
  // Per-suite key prefix for test isolation per the iter-194 SUITE_TAG
  // rule — concurrent specs writing to the same `throttler_records`
  // table cannot contaminate this spec's row counts.
  const PREFIX = `throttler-e2e-${crypto.randomUUID()}::`;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the throttler-cleanup e2e suite");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    cron = new ThrottlerCleanupCron(prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    cron.onModuleDestroy();
    await prisma.$executeRawUnsafe(
      `DELETE FROM "throttler_records" WHERE "key" LIKE $1`,
      `${PREFIX}%`,
    );
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "throttler_records" WHERE "key" LIKE $1`,
      `${PREFIX}%`,
    );
  });

  async function seed(label: string, expiresAt: Date): Promise<void> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "throttler_records" ("key", "count", "expires_at") VALUES ($1, $2, $3)`,
      `${PREFIX}${label}-${crypto.randomUUID()}`,
      1,
      expiresAt,
    );
  }

  async function countOurs(): Promise<number> {
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::text AS count FROM "throttler_records" WHERE "key" LIKE $1`,
      `${PREFIX}%`,
    )) as Array<{ count: string }>;
    return Number.parseInt(rows[0]?.count ?? "0", 10);
  }

  it("runOnce() executes a SQL DELETE against rows whose expires_at < now - 1 day", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed("ancient", new Date(now - 10 * day)); // 10d expired → pruned
    await seed("borderline-old", new Date(now - 2 * day)); // 2d expired → pruned (>1d)
    await seed("recent", new Date(now - 12 * 60 * 60 * 1000)); // 12h expired → retained (<1d)
    await seed("future", new Date(now + day)); // not yet expired → retained

    await cron.runOnce();
    expect(await countOurs()).toBe(2);
  });

  it("runOnce() returns 0 when every OUR row is inside the 1-day retention window", async () => {
    const now = Date.now();
    await seed("recent-1", new Date(now - 12 * 60 * 60 * 1000));
    await seed("recent-2", new Date(now + 60 * 60 * 1000));

    await cron.runOnce();
    expect(await countOurs()).toBe(2);
  });

  it("the index `throttler_records_expires_at_idx` exists in pg_indexes (iter-77 migration)", async () => {
    const result = (await prisma.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'throttler_records'
          AND indexname = 'throttler_records_expires_at_idx'`,
    )) as Array<{ indexname: string }>;
    expect(result).toHaveLength(1);
    expect(result[0]?.indexname).toBe("throttler_records_expires_at_idx");
  });

  it("THROTTLER_CLEANUP_INTERVAL_MS = 1 hour (matches the migration's documented cadence)", async () => {
    const { THROTTLER_CLEANUP_INTERVAL_MS } =
      await import("../src/core/throttler/throttler-cleanup.js");
    expect(THROTTLER_CLEANUP_INTERVAL_MS).toBe(60 * 60 * 1000);
  });
});
