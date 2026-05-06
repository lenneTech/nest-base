import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
// Per-suite tenant UUID — concurrent specs writing to the same
// `audit_log` table (audit-browser-data.e2e-spec.ts) used to share
// this hardcoded value; iter-194 isolates each spec to its own
// tenant so afterAll deletions don't wipe sibling specs' seeded rows.
const TENANT = crypto.randomUUID();

/**
 * E2E · AuditLog Prisma model (CF.AUD.* / PRD § Core Features § Audit).
 *
 * The audit Prisma extension writes `{action, target, diff, metadata}`
 * rows to the `audit_log` table on every opted-in CUD. The model
 * lives in the always-on core schema so the table exists at migrate
 * time even when `features.audit.enabled === false` — the feature
 * flag controls whether the extension WRITES rows, not whether the
 * table exists.
 *
 * This test asserts the model + table are wired end-to-end:
 *   - PrismaService exposes `auditLog` as a delegate
 *   - direct insert + read round-trip works through the table
 *   - the indexes (tenant+createdAt, targetModel+targetId, actor+createdAt)
 *     don't reject realistic filter queries
 *
 * RLS coverage: the migration enables ENABLE ROW LEVEL SECURITY on
 * the table — `tests/check-rls-runtime.e2e-spec.ts` asserts the
 * runtime flag matches.
 */
describe("E2E · AuditLog model + table (CF.AUD.*)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { tenantId: TENANT } });
    } catch {
      // ignore — testcontainer is tossed by global-setup anyway
    }
    await app.close();
  });

  it("PrismaService exposes the auditLog delegate", () => {
    expect(prisma.auditLog).toBeDefined();
    expect(typeof prisma.auditLog.create).toBe("function");
    expect(typeof prisma.auditLog.findMany).toBe("function");
  });

  it("inserts an AuditLog row + reads it back", async () => {
    const targetId = "00000000-0000-0000-0000-000000000123";
    const created = await prisma.auditLog.create({
      data: {
        tenantId: TENANT,
        actorUserId: null,
        targetModel: "Example",
        targetId,
        action: "CREATE",
        diff: { after: { name: "First" } },
        metadata: { requestId: "req-1" },
      },
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.action).toBe("CREATE");
    expect(created.targetModel).toBe("Example");
    expect(created.diff).toEqual({ after: { name: "First" } });

    const fetched = await prisma.auditLog.findUnique({ where: { id: created.id } });
    expect(fetched).not.toBeNull();
    expect(fetched!.action).toBe("CREATE");
  });

  it("queries by composite indexes succeed (tenantId+createdAt, targetModel+targetId)", async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000);

    const byTenantTimeline = await prisma.auditLog.findMany({
      where: { tenantId: TENANT, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    expect(Array.isArray(byTenantTimeline)).toBe(true);

    const byTarget = await prisma.auditLog.findMany({
      where: { targetModel: "Example", targetId: "00000000-0000-0000-0000-000000000123" },
    });
    expect(Array.isArray(byTarget)).toBe(true);
    expect(byTarget.length).toBeGreaterThanOrEqual(1);
  });

  it("AuditAction enum accepts each value (CREATE / UPDATE / DELETE / RESTORE)", async () => {
    const actions = ["CREATE", "UPDATE", "DELETE", "RESTORE"] as const;
    for (const action of actions) {
      const row = await prisma.auditLog.create({
        data: {
          tenantId: TENANT,
          actorUserId: null,
          targetModel: "Example",
          targetId: `target-${action}`,
          action,
          diff: { note: `enum check ${action}` },
        },
      });
      expect(row.action).toBe(action);
    }
  });
});
