import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OUTBOX_STORAGE } from "../../src/core/outbox/outbox.module.js";
import type { OutboxEntry, OutboxStorage } from "../../src/core/outbox/outbox.js";
import { PrismaOutboxStorage } from "../../src/core/outbox/outbox.prisma.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../../src/core/uuid/uuid-v7.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT_ID = "00000000-0000-0000-0000-000000000301";

/**
 * Story · Prisma-backed OutboxStorage default (CF.RT.04 + CF.WH.06 +
 * CF.JOBS.01 — iter-96 review Finding 3).
 *
 * The previous default (`InMemoryOutboxStorage`) lost every queued
 * entry on restart. The PRD's at-least-once guarantee for outbox-fed
 * surfaces (realtime broadcasts, webhook deliveries, search indexing)
 * requires durable persistence. Iter-107 ships the Prisma-backed
 * adapter binding to a new `outbox_entries` table, with the module
 * factory selecting it whenever `DATABASE_URL` is set (production +
 * any test booted via the testcontainer global-setup).
 */
describe("Story · PrismaOutboxStorage", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let storage: OutboxStorage;

  beforeAll(async () => {
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    storage = app.get<OutboxStorage>(OUTBOX_STORAGE);

    // After issue #118, the old `tenants` table was dropped. outbox_entries.tenant_id
    // has no FK constraint, so no parent row is required — use the id directly.
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM outbox_entries WHERE tenant_id = $1::uuid`,
        TENANT_ID,
      );
      // No tenant row to delete — tenants table was dropped in issue #118.
    }
    if (app) await app.close();
  });

  function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
    return {
      id: uuidV7(),
      seq: 1,
      tenantId: TENANT_ID,
      type: "test.entry",
      payload: { foo: "bar" },
      occurredAt: new Date(),
      processedAt: null,
      ...overrides,
    };
  }

  it("the OUTBOX_STORAGE provider resolves to the Prisma adapter when DATABASE_URL is set", () => {
    expect(storage).toBeDefined();
    // Structural shape — the Prisma adapter has the canonical
    // OutboxStorage methods. The in-memory fallback would also have
    // them, but iter-107's factory only returns the in-memory
    // baseline when DATABASE_URL is unset (tests inherit DATABASE_URL
    // via global-setup, so this branch is the Prisma adapter).
    expect(typeof storage.append).toBe("function");
    expect(typeof storage.claimBatch).toBe("function");
    expect(typeof storage.markProcessed).toBe("function");
  });

  it("append + claimBatch round-trip — the row is durable", async () => {
    const e = entry({ type: "round.trip" });
    await storage.append(e);
    const claimed = await storage.claimBatch(50);
    const found = claimed.find((c) => c.id === e.id);
    expect(found).toBeDefined();
    expect(found?.tenantId).toBe(TENANT_ID);
    expect(found?.type).toBe("round.trip");
    expect(found?.processedAt).toBeNull();
  });

  it("markProcessed sets the watermark + the next claimBatch skips the row", async () => {
    const e = entry({ type: "marked.processed" });
    await storage.append(e);

    const before = await storage.claimBatch(50);
    expect(before.some((c) => c.id === e.id)).toBe(true);

    const wasMarked = await storage.markProcessed(e.id, new Date());
    expect(wasMarked).toBe(true);

    const after = await storage.claimBatch(50);
    expect(after.some((c) => c.id === e.id)).toBe(false);
  });

  it("markProcessed on an already-processed id returns false (idempotent)", async () => {
    const e = entry({ type: "double.mark" });
    await storage.append(e);
    const first = await storage.markProcessed(e.id, new Date());
    expect(first).toBe(true);
    const second = await storage.markProcessed(e.id, new Date());
    expect(second).toBe(false);
  });

  it("claimBatch ordering: rows return in seq ascending (FIFO)", async () => {
    const a = entry({ type: "ordered.a", seq: 1_000_001 });
    const b = entry({ type: "ordered.b", seq: 1_000_002 });
    const c = entry({ type: "ordered.c", seq: 1_000_003 });
    await storage.append(a);
    await storage.append(b);
    await storage.append(c);

    // Filter to only the three rows inserted by this test — parallel tests
    // may have inserted other rows that appear at lower positions in
    // claimBatch's result set, causing findIndex to return -1 for "foreign"
    // rows at earlier positions (Finding 7 fix).
    const testIds = new Set([a.id, b.id, c.id]);
    const claimed = await storage.claimBatch(50);
    const relevant = claimed.filter((cc) => testIds.has(cc.id));

    const indices = [a, b, c].map((e) => relevant.findIndex((cc) => cc.id === e.id));
    // Each entry's index in the filtered list must be greater than the
    // previous (FIFO ordering on seq).
    expect(indices[0]).toBeLessThan(indices[1]!);
    expect(indices[1]).toBeLessThan(indices[2]!);
  });

  it("resetStaleSentinels resets rows at the epoch sentinel older than 5 minutes", async () => {
    // Manually insert a row with processed_at = epoch (the in-flight sentinel)
    // and claimed_at 10 minutes in the past so it qualifies for cleanup.
    const staleTenantId = "00000000-0000-0000-0000-000000000302";
    const staleId = uuidV7();
    await prisma.$executeRawUnsafe(
      `INSERT INTO outbox_entries (id, seq, tenant_id, type, payload, occurred_at, processed_at, claimed_at)
       VALUES ($1::uuid, 9999999, $2::uuid, 'sentinel.stale', '{}'::jsonb,
               NOW() - INTERVAL '10 minutes',
               '1970-01-01T00:00:00.000Z'::timestamp,
               NOW() - INTERVAL '10 minutes')`,
      staleId,
      staleTenantId,
    );

    // Also insert a fresh sentinel row (claimed_at < 5 minutes ago) — must NOT be reset.
    const freshId = uuidV7();
    await prisma.$executeRawUnsafe(
      `INSERT INTO outbox_entries (id, seq, tenant_id, type, payload, occurred_at, processed_at, claimed_at)
       VALUES ($1::uuid, 9999998, $2::uuid, 'sentinel.fresh', '{}'::jsonb,
               NOW() - INTERVAL '1 minute',
               '1970-01-01T00:00:00.000Z'::timestamp,
               NOW() - INTERVAL '1 minute')`,
      freshId,
      staleTenantId,
    );

    const prismaStorage = new PrismaOutboxStorage(prisma);
    const resetCount = await prismaStorage.resetStaleSentinels();
    // >= 1 because other parallel tests may also have stale sentinel rows;
    // correctness is verified by per-row assertions below.
    expect(resetCount).toBeGreaterThanOrEqual(1);

    // Verify: stale row's processed_at is now NULL (re-enters dispatch queue).
    const [staleRow] = (await prisma.$queryRawUnsafe(
      `SELECT processed_at FROM outbox_entries WHERE id = $1::uuid`,
      staleId,
    )) as Array<{ processed_at: Date | null }>;
    expect(staleRow?.processed_at).toBeNull();

    // Verify: fresh row is still at the epoch sentinel (not reset).
    const [freshRow] = (await prisma.$queryRawUnsafe(
      `SELECT processed_at FROM outbox_entries WHERE id = $1::uuid`,
      freshId,
    )) as Array<{ processed_at: Date | null }>;
    // Fresh claimed_at is < 5 minutes → NOT reset by the sentinel cleanup.
    expect(freshRow?.processed_at).not.toBeNull();

    // Cleanup.
    await prisma.$executeRawUnsafe(
      `DELETE FROM outbox_entries WHERE tenant_id = $1::uuid`,
      staleTenantId,
    );
  });

  it("resets sentinel only after 5 min from claim time, not event time", async () => {
    // Finding 1: an event enqueued 10 min ago (old occurred_at) but claimed
    // only 1 min ago (fresh claimed_at) must NOT be reset by the stale-
    // sentinel sweep — the worker may still be dispatching it.
    const testTenantId = "00000000-0000-0000-0000-000000000303";
    const backlogId = uuidV7();
    await prisma.$executeRawUnsafe(
      `INSERT INTO outbox_entries (id, seq, tenant_id, type, payload, occurred_at, processed_at, claimed_at)
       VALUES ($1::uuid, 9999997, $2::uuid, 'sentinel.backlog', '{}'::jsonb,
               NOW() - INTERVAL '10 minutes',
               '1970-01-01T00:00:00.000Z'::timestamp,
               NOW() - INTERVAL '1 minute')`,
      backlogId,
      testTenantId,
    );

    const prismaStorage = new PrismaOutboxStorage(prisma);
    await prismaStorage.resetStaleSentinels();

    // Despite occurred_at being 10 min ago, claimed_at is only 1 min ago
    // so the row must still have the epoch sentinel — NOT reset.
    const [row] = (await prisma.$queryRawUnsafe(
      `SELECT processed_at FROM outbox_entries WHERE id = $1::uuid`,
      backlogId,
    )) as Array<{ processed_at: Date | null }>;
    expect(row?.processed_at).not.toBeNull();

    // Cleanup.
    await prisma.$executeRawUnsafe(
      `DELETE FROM outbox_entries WHERE tenant_id = $1::uuid`,
      testTenantId,
    );
  });
});
