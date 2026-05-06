import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_VERIFICATION_RETENTION_DAYS,
  PrismaVerificationStore,
  VerificationCleanupCron,
} from "../src/core/auth/verification-cleanup.js";
import type { PrismaService } from "../src/core/prisma/prisma.service.js";

/**
 * E2E · `VerificationCleanupCron` against real Postgres (iter-193).
 *
 * Iter-193 added the Better-Auth verifications cleanup cron at the
 * unit level; this e2e closes the matching real-Postgres gap mirroring
 * iter-182 (idempotency-cleanup) + iter-185 (variant-cleanup) shapes.
 * Real `PrismaClient` → `PrismaVerificationStore` → real
 * `prisma.verification.deleteMany({where:{expiresAt:{lt:Date}}})`
 * fires against the live `verifications` table.
 *
 * Per-suite identifier prefix isolates the assertions from concurrent
 * specs writing to the same `verifications` table.
 */
describe("E2E · VerificationCleanupCron prunes stale Better-Auth verification rows from real Postgres", () => {
  let prisma: PrismaClient;
  let store: PrismaVerificationStore;
  let cron: VerificationCleanupCron;
  const PREFIX = `cleanup-e2e-${crypto.randomUUID()}::`;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the verification-cleanup e2e suite");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    store = new PrismaVerificationStore(prisma as unknown as PrismaService);
    cron = new VerificationCleanupCron(store);
  });

  afterAll(async () => {
    cron.onModuleDestroy();
    await prisma.verification.deleteMany({ where: { identifier: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.verification.deleteMany({ where: { identifier: { startsWith: PREFIX } } });
  });

  async function seed(label: string, expiresAt: Date): Promise<void> {
    await prisma.$executeRawUnsafe(
      `INSERT INTO verifications (id, identifier, value, "expires_at", "created_at", "updated_at")
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())`,
      `${PREFIX}${label}-${crypto.randomUUID()}`,
      `value-${label}`,
      expiresAt,
    );
  }

  async function countOurs(): Promise<number> {
    return await prisma.verification.count({ where: { identifier: { startsWith: PREFIX } } });
  }

  it("runOnce() executes a SQL DELETE against rows whose expiresAt < now - 7 days", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed("ancient", new Date(now - 30 * day));
    await seed("borderline-old", new Date(now - 8 * day));
    await seed("recent-but-expired", new Date(now - 2 * day)); // expired but inside retention
    await seed("fresh", new Date(now + day));

    // No pre-cleanup count assertion: concurrent specs that boot the
    // app fire their own `VerificationCleanupCron.runOnce()` on
    // OnModuleInit, which can sweep OUR ancient + borderline-old rows
    // between seed() and the assertion. The post-cleanup count is the
    // real test — and it's the same number whether OUR cron or a
    // concurrent boot's cron did the pruning.
    await cron.runOnce();
    // Two stale rows pruned (>7d expired); two retained
    // (recent-but-expired + fresh).
    expect(await countOurs()).toBe(2);
  });

  it("runOnce() returns 0 when every OUR row is inside the retention window", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed("retention-1", new Date(now - 1 * day));
    await seed("retention-2", new Date(now - 6 * day));

    await cron.runOnce();
    expect(await countOurs()).toBe(2);
  });

  it("runOnce() is idempotent — second tick deletes 0 because the first already pruned", async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed("ancient-1", new Date(now - 50 * day));
    await seed("ancient-2", new Date(now - 100 * day));

    await cron.runOnce();
    expect(await countOurs()).toBe(0);
    await cron.runOnce();
    expect(await countOurs()).toBe(0);
  });

  it("DEFAULT_VERIFICATION_RETENTION_DAYS = 7 — verifies the cutoff math against the actual SQL filter", async () => {
    expect(DEFAULT_VERIFICATION_RETENTION_DAYS).toBe(7);
    // Sanity: a row expired exactly at the retention boundary is on the
    // "keep" side (expiresAt = cutoff is NOT < cutoff). Pin this with a
    // row aged 6 days 23 hours (just inside) and another 7 days 1 hour
    // (just past).
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed("just-inside", new Date(now - (7 * day - 60 * 60 * 1000))); // ~6d23h
    await seed("just-outside", new Date(now - (7 * day + 60 * 60 * 1000))); // ~7d1h

    await cron.runOnce();
    expect(await countOurs()).toBe(1);
  });

  it("the index `verifications_expires_at_idx` exists so the cron's deleteMany is O(log N)", async () => {
    // Migration `20260506160000_verifications_expires_at` ships
    // `CREATE INDEX verifications_expires_at_idx ON verifications
    // (expires_at)` to back the cron's
    // `deleteMany({where:{expiresAt:{lt:Date}}})` query. Without this
    // index Postgres falls back to a sequential scan; the existence
    // probe pins the migration's promise so a future schema-diff
    // that drops the index trips the gate.
    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'verifications'
          AND indexname = 'verifications_expires_at_idx'`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexname).toBe("verifications_expires_at_idx");
  });
});
