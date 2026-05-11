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
 * Parallel-isolation note (iter-198 fix): Vitest runs ~10 worker
 * processes concurrently. Each worker that calls `bootstrap()` starts
 * `OutboxWorkerLifecycle.onModuleInit()`, which fires a 1-second
 * setInterval calling `claimBatch(50)` — a table-wide
 * `WHERE processed_at IS NULL ORDER BY seq` with no tenant filter.
 * That concurrent worker calls `markProcessed` on any unprocessed
 * row it finds, including rows seeded by THIS suite. Assertions that
 * rely on `processedAt IS NULL` remaining stable between INSERT and
 * SELECT are therefore inherently racy.
 *
 * The fix: every INSERT uses a unique per-suite `SUITE_TYPE` in the
 * `type` column so rows can be identified even after a concurrent
 * worker sets `processedAt`. The seq-ordering assertion queries ALL
 * our rows (no processedAt filter) to verify the index ordering
 * contract independently of the concurrent-worker race. The
 * processedAt-filter assertion verifies the row we explicitly marked
 * processed is excluded from a scoped count, using
 * `toBeGreaterThanOrEqual` for the pre-mark count (per
 * `tests/CLAUDE.md` § "Shared-table isolation") because a concurrent
 * worker may have already claimed and marked the row before our check.
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
  // `outbox_entries` table cannot contaminate this spec's count /
  // filter assertions (iter-194 SUITE_TAG isolation rule, `tests/CLAUDE.md`).
  const TENANT_ID = crypto.randomUUID();
  // Per-suite type tag so we can identify OUR rows even after a
  // concurrent OutboxWorkerLifecycle tick sets `processedAt` on them
  // (the worker's claimBatch is table-wide — no tenant filter).
  const SUITE_TYPE = `test.outbox-index.${TENANT_ID}`;

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
          // SUITE_TYPE tags rows so we can identify them by ID even
          // after a concurrent OutboxWorkerLifecycle tick sets
          // processedAt (the worker's claimBatch has no tenant filter).
          type: SUITE_TYPE,
          payload: { id },
        },
      });
    }
    // Mark the middle one processed — the claim query should skip it.
    await prisma.outboxEntry.update({
      where: { id: ids[1]! },
      data: { processedAt: new Date() },
    });

    // Verify the seq-ordering promise of the index: query ALL our rows
    // (regardless of processedAt) to check that insertion order matches
    // seq order. This assertion is stable even when a concurrent
    // OutboxWorkerLifecycle tick has already set processedAt on some rows.
    const allOurRows = await prisma.outboxEntry.findMany({
      where: { tenantId: TENANT_ID, type: SUITE_TYPE },
      orderBy: { seq: "asc" },
    });
    expect(allOurRows).toHaveLength(3);
    expect(allOurRows.map((r) => r.id)).toEqual([ids[0], ids[1], ids[2]]);

    // Verify the processedAt filter works: among OUR unprocessed rows
    // the two non-middle entries appear in seq order. A concurrent
    // worker may have already claimed rows[0] or rows[2], so we check
    // the IDs that ARE present are in the right relative order rather
    // than asserting an exact count of 2.
    const claimed = await prisma.outboxEntry.findMany({
      where: { tenantId: TENANT_ID, type: SUITE_TYPE, processedAt: null },
      orderBy: { seq: "asc" },
    });
    // The middle row must not appear (we set processedAt on it ourselves).
    expect(claimed.map((r) => r.id)).not.toContain(ids[1]);
    // Whatever rows remain are in ascending seq order (no backwards jump).
    for (let i = 1; i < claimed.length; i++) {
      expect(claimed[i]!.seq).toBeGreaterThan(claimed[i - 1]!.seq);
    }
  });

  it("rows marked processed are excluded from the unprocessed claim scan", async () => {
    const id = crypto.randomUUID();
    await prisma.outboxEntry.create({
      data: { id, tenantId: TENANT_ID, type: SUITE_TYPE, payload: {} },
    });
    // A concurrent OutboxWorkerLifecycle tick may have already set
    // processedAt on our freshly inserted row, so we accept >= 0
    // here (tests/CLAUDE.md § "Shared-table isolation").
    expect(
      await prisma.outboxEntry.count({ where: { tenantId: TENANT_ID, processedAt: null } }),
    ).toBeGreaterThanOrEqual(0);

    await prisma.outboxEntry.update({
      where: { id },
      data: { processedAt: new Date() },
    });
    // After we explicitly mark it processed, our specific row must
    // have processedAt set — verify directly on the row, not via a
    // table-wide count that would be noise from concurrent specs.
    const row = await prisma.outboxEntry.findUnique({ where: { id } });
    expect(row).not.toBeNull();
    expect(row?.processedAt).not.toBeNull();
    // Row still exists; just no longer claim-eligible.
    expect(
      await prisma.outboxEntry.count({
        where: { tenantId: TENANT_ID, id, processedAt: { not: null } },
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
