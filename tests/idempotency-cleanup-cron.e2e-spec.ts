import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { IdempotencyCleanupCron } from "../src/core/idempotency/idempotency-cleanup.js";
import { PrismaIdempotencyStore } from "../src/core/idempotency/idempotency-store.prisma.js";
import type { PrismaService } from "../src/core/prisma/prisma.service.js";

/**
 * E2E · Prisma-backed `IdempotencyCleanupCron` against a real Postgres
 * testcontainer (CF.STORAGE.01 follow-up — iter-182).
 *
 * Iter-181 added the cleanup cron + `deleteOlderThan` adapter method.
 * The story tests cover the cron's lifecycle + the in-memory adapter
 * + the Prisma fake's `deleteMany` delegation. This e2e closes the
 * remaining gap: the cron firing through the real `idempotency_records`
 * table proves the SQL DELETE actually executes against the
 * `expiresAt` index from migration `20260506100000_idempotency_records`.
 *
 * The test reuses the global Postgres testcontainer (`global-setup.ts`
 * spawns it on first import) so we don't pay the spin-up cost twice.
 */
describe("E2E · IdempotencyCleanupCron prunes expired rows from real Postgres", () => {
  let prisma: PrismaClient;
  let store: PrismaIdempotencyStore;
  let cron: IdempotencyCleanupCron;
  // Per-suite key prefix so concurrent specs (e.g. the interceptor
  // e2e from iter-180) writing to the same `idempotency_records` table
  // do not contaminate the cleanup assertions. Each test seeds rows
  // under this prefix and the count queries filter by it.
  const PREFIX = `cleanup-e2e-${crypto.randomUUID()}::`;

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the idempotency-cleanup e2e suite");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    store = new PrismaIdempotencyStore(prisma as unknown as PrismaService);
    cron = new IdempotencyCleanupCron(store);
  });

  afterAll(async () => {
    cron.onModuleDestroy();
    await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.idempotencyRecord.deleteMany({ where: { key: { startsWith: PREFIX } } });
  });

  function pkey(label: string): string {
    return `${PREFIX}${label}-${crypto.randomUUID()}`;
  }

  async function countOurs(): Promise<number> {
    return await prisma.idempotencyRecord.count({ where: { key: { startsWith: PREFIX } } });
  }

  it("runOnce() executes a SQL DELETE against rows with expiresAt < now and leaves live rows untouched", async () => {
    const now = Date.now();
    await store.put({
      key: pkey("expired"),
      requestHash: "rh-1",
      status: 201,
      body: { v: 1 },
      expiresAt: now - 60_000,
    });
    await store.put({
      key: pkey("expired"),
      requestHash: "rh-2",
      status: 201,
      body: { v: 2 },
      expiresAt: now - 1,
    });
    const liveKey = pkey("live");
    await store.put({
      key: liveKey,
      requestHash: "rh-3",
      status: 201,
      body: { v: 3 },
      expiresAt: now + 60_000,
    });

    expect(await countOurs()).toBe(3);

    // The cron's deleteOlderThan runs against the WHOLE table — but
    // its observable result here is "every one of OUR expired rows
    // is gone, OUR live row is untouched". Concurrent rows from
    // other suites are filtered out by the prefix.
    await cron.runOnce();

    expect(await countOurs()).toBe(1);
    const survivor = await prisma.idempotencyRecord.findUnique({ where: { key: liveKey } });
    expect(survivor).not.toBeNull();
    expect(survivor!.status).toBe(201);
  });

  it("runOnce() returns deleted=0 when every row is still live (no spurious DELETE under sustained traffic)", async () => {
    const now = Date.now();
    await store.put({
      key: pkey("live"),
      requestHash: "rh-a",
      status: 200,
      body: { ok: true },
      expiresAt: now + 24 * 60 * 60 * 1000,
    });
    await store.put({
      key: pkey("live"),
      requestHash: "rh-b",
      status: 200,
      body: { ok: true },
      expiresAt: now + 12 * 60 * 60 * 1000,
    });

    await cron.runOnce();
    // Our two live rows still present.
    expect(await countOurs()).toBe(2);
  });

  it("runOnce() is idempotent — second call deletes 0 because the first call already pruned", async () => {
    const now = Date.now();
    await store.put({
      key: pkey("expired"),
      requestHash: "rh-x",
      status: 500,
      body: null,
      expiresAt: now - 1_000,
    });
    await store.put({
      key: pkey("expired"),
      requestHash: "rh-y",
      status: 500,
      body: null,
      expiresAt: now - 5,
    });

    await cron.runOnce();
    expect(await countOurs()).toBe(0);

    // Second tick — every prior row from this suite has already been
    // pruned, so OUR row count stays at 0. Concurrent suites' rows
    // don't matter for this assertion.
    await cron.runOnce();
    expect(await countOurs()).toBe(0);
  });

  it("the index `idempotency_records_expires_at_idx` exists so the prune is O(log N)", async () => {
    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'idempotency_records' AND indexname = 'idempotency_records_expires_at_idx'`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0]?.indexname).toBe("idempotency_records_expires_at_idx");
  });
});
