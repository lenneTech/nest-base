import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * E2E · `outbox_entries` index probe + worker claim-predicate
 * (iter-198 — extends the iter-181/iter-185/iter-197 cleanup-cron
 * index-probe pattern to the OutboxWorker's load-bearing scan).
 *
 * The outbox worker's hot path is: "scan unprocessed rows ordered
 * by seq". The matching index `outbox_entries_processed_at_seq_idx`
 * was added in migration `20260505180000_outbox_entries` to back
 * `WHERE processed_at IS NULL ORDER BY seq`. Without the index the
 * scan is O(N) over every row, including SUCCEEDED rows still in
 * the audit retention window. This e2e pins the migration's
 * promise so a future schema-diff that drops the index trips the
 * gate.
 *
 * Coverage today:
 * - `tests/stories/outbox-worker.story.test.ts` (in-memory adapter
 *   round-trip)
 * - `tests/stories/outbox-prisma-storage.story.test.ts` (Prisma
 *   adapter delegate-shape against fakes)
 *
 * What was missing: an index-existence probe + a real-Postgres
 * exercise of the worker's claim SQL semantics. Closed here.
 */
describe("E2E · OutboxEntry index probe + worker claim predicate (iter-198)", () => {
  let prisma: PrismaClient;
  // Per-suite tenant UUID so concurrent specs writing to the same
  // `outbox_entries` table cannot contaminate this spec's claim
  // assertions (iter-194 SUITE_TAG isolation rule, `tests/CLAUDE.md`).
  const TENANT_ID = crypto.randomUUID();

  beforeAll(() => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the outbox-entry-index e2e suite");
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await prisma.outboxEntry.deleteMany({ where: { tenantId: TENANT_ID } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.outboxEntry.deleteMany({ where: { tenantId: TENANT_ID } });
  });

  it("the index `outbox_entries_processed_at_seq_idx` exists in pg_indexes", async () => {
    const result = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'outbox_entries'
          AND indexname = 'outbox_entries_processed_at_seq_idx'`,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.indexname).toBe("outbox_entries_processed_at_seq_idx");
  });

  it("the worker's claim predicate (processed_at IS NULL ORDER BY seq) returns rows in seq order", async () => {
    // Insert 3 rows with monotonic-but-non-sequential `seq` values
    // (Postgres' SERIAL column auto-assigns; we assert the ORDER BY
    // is honored regardless of insert order).
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of ids) {
      await prisma.outboxEntry.create({
        data: {
          id,
          tenantId: TENANT_ID,
          type: "test.event",
          payload: { id },
        },
      });
    }
    // Mark the middle one processed — the claim query should skip it.
    await prisma.outboxEntry.update({
      where: { id: ids[1]! },
      data: { processedAt: new Date() },
    });

    // Mirror the worker's claim predicate.
    const claimed = await prisma.outboxEntry.findMany({
      where: { tenantId: TENANT_ID, processedAt: null },
      orderBy: { seq: "asc" },
    });
    expect(claimed).toHaveLength(2);
    expect(claimed[0]?.id).toBe(ids[0]);
    expect(claimed[1]?.id).toBe(ids[2]);
  });

  it("rows marked processed are excluded from the unprocessed claim scan", async () => {
    const id = crypto.randomUUID();
    await prisma.outboxEntry.create({
      data: { id, tenantId: TENANT_ID, type: "test.event", payload: {} },
    });
    expect(
      await prisma.outboxEntry.count({ where: { tenantId: TENANT_ID, processedAt: null } }),
    ).toBe(1);

    await prisma.outboxEntry.update({
      where: { id },
      data: { processedAt: new Date() },
    });
    expect(
      await prisma.outboxEntry.count({ where: { tenantId: TENANT_ID, processedAt: null } }),
    ).toBe(0);
    // Row still exists; just no longer claim-eligible.
    expect(
      await prisma.outboxEntry.count({
        where: { tenantId: TENANT_ID, processedAt: { not: null } },
      }),
    ).toBe(1);
  });

  it("RLS is enabled on outbox_entries (tenant isolation defence-in-depth)", async () => {
    // Migration `20260505180000_outbox_entries` enables RLS on the
    // table. Probe `pg_class.relrowsecurity` to confirm.
    const result = await prisma.$queryRawUnsafe<Array<{ relrowsecurity: boolean }>>(
      `SELECT relrowsecurity FROM pg_class
        WHERE relname = 'outbox_entries' AND relkind = 'r'`,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.relrowsecurity).toBe(true);
  });
});
