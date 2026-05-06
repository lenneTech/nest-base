import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PrismaService } from "../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../src/core/uuid/uuid-v7.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * E2E · Prisma audit extension live SELECT round-trip (SC.SUB.07/08
 * closure — iter-186).
 *
 * The deviation register's SC.SUB.* row notes: "the shipped story
 * tests assert the planner / builder layer exhaustively but stop
 * short of the live Postgres SELECT round-trip" for the audit
 * subsystem. The story `tests/stories/audit-log-extension.story.test.ts`
 * covers the audit-builder's pure-function logic; the model-level
 * `tests/audit-log-model.e2e-spec.ts` proves direct insert + read
 * works through `prisma.auditLog`. The remaining gap: that the
 * `auditExtension` factory wired into `PrismaService.client`
 * actually FIRES on `client.<auditableModel>.create/update/delete`
 * AND lands a row at `audit_log` that downstream queries can read.
 *
 * This e2e closes that gap by:
 *   1. Booting the full app (bootstrap) so the extension chain is
 *      live with its production wiring (`buildAuditExtension` from
 *      `prisma.service.ts`).
 *   2. Performing CUD against `Role` (auditable + tenantId-scoped) via
 *      `prisma.client.role.*` — the extended client.
 *   3. Reading back via `prisma.auditLog.findMany({where:{targetModel,
 *      targetId}})` and asserting the row's action, diff, and tenantId.
 *
 * Per-suite tenantId isolates the assertions from concurrent specs.
 */
describe("E2E · Audit Prisma extension fires through the extended client (SC.SUB.07/08)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    const orgName = `audit-ext-e2e-${crypto.randomUUID()}`;
    const tenant = await prisma.organization.create({
      data: {
        id: uuidV7(),
        name: orgName,
        slug:
          orgName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 50) +
          "-" +
          Date.now(),
        createdAt: new Date(),
      },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    try {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.role.deleteMany({ where: { tenantId } });
      await prisma.organization.delete({ where: { id: tenantId } });
    } catch {
      /* best-effort cleanup */
    }
    await app.close();
  });

  beforeEach(async () => {
    // Each test starts with no audit rows for this tenant; the
    // tenant-scoped key keeps concurrent specs isolated.
    await prisma.auditLog.deleteMany({ where: { tenantId } });
    await prisma.role.deleteMany({ where: { tenantId } });
  });

  it("client.role.create lands a CREATE audit row with `diff.after` containing the persisted shape", async () => {
    const role = await prisma.client.role.create({
      data: {
        name: `e2e-create-${crypto.randomUUID()}`,
        tenantId,
        description: "audit-ext e2e test",
      },
    });

    const auditRows = await prisma.auditLog.findMany({
      where: { targetModel: "Role", targetId: role.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("CREATE");
    expect(auditRows[0]?.tenantId).toBe(tenantId);
    const diff = auditRows[0]?.diff as { after?: Record<string, unknown> };
    expect(diff.after).toBeDefined();
    expect(diff.after!.name).toBe(role.name);
    expect(diff.after!.tenantId).toBe(tenantId);
  });

  it("client.role.update lands an UPDATE audit row with `diff.before` + `diff.after`", async () => {
    const role = await prisma.client.role.create({
      data: { name: `e2e-update-${crypto.randomUUID()}`, tenantId, description: "before" },
    });
    // Clear the CREATE row so the next assertion only sees the UPDATE.
    await prisma.auditLog.deleteMany({ where: { tenantId, targetId: role.id } });

    await prisma.client.role.update({
      where: { id: role.id },
      data: { description: "after" },
    });

    const auditRows = await prisma.auditLog.findMany({
      where: { targetModel: "Role", targetId: role.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("UPDATE");
    const diff = auditRows[0]?.diff as {
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
    };
    expect(diff.before?.description).toBe("before");
    expect(diff.after?.description).toBe("after");
  });

  it("client.role.delete with hardDelete:true lands a DELETE audit row with `diff.before` carrying the row state", async () => {
    const role = await prisma.client.role.create({
      data: { name: `e2e-delete-${crypto.randomUUID()}`, tenantId },
    });
    await prisma.auditLog.deleteMany({ where: { tenantId, targetId: role.id } });

    // softDeleteExtension blocks bare `delete()` and rewrites it to
    // an `update({deletedAt})`. Hard-deleting via `{hardDelete:true}`
    // is the explicit bypass — that path drives the audit
    // extension's DELETE branch with the row's pre-delete state in
    // `diff.before` (since `readBeforeImage` is wired in production).
    await prisma.client.role.delete({ where: { id: role.id }, hardDelete: true });

    const auditRows = await prisma.auditLog.findMany({
      where: { targetModel: "Role", targetId: role.id },
    });
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.action).toBe("DELETE");
    // The before-image is sourced via `$queryRawUnsafe` (see
    // `prisma.service.ts:228-242`), so the keys reflect the
    // database column names (snake_case) — `tenant_id` not
    // `tenantId`. That's the production contract: the audit row's
    // `diff.before` is a verbatim row snapshot from `SELECT *`.
    const diff = auditRows[0]?.diff as { before?: Record<string, unknown> };
    expect(diff.before?.id).toBe(role.id);
    expect(diff.before?.tenant_id).toBe(tenantId);
  });

  it("non-auditable models (e.g. HealthPing — not in auditableModels) do NOT emit audit rows", async () => {
    // The extension chain's audit pass is per-model opt-in. HealthPing
    // is not in the list at `prisma.service.ts:256-264` so its CUD
    // ops should never write to audit_log.
    const ping = await prisma.client.healthPing.create({ data: {} });
    const auditRows = await prisma.auditLog.findMany({
      where: { targetModel: "HealthPing", targetId: ping.id },
    });
    expect(auditRows).toEqual([]);
    // Cleanup.
    await prisma.healthPing.delete({ where: { id: ping.id } });
  });

  it("multiple CUD operations on the same role land separate audit rows in chronological order", async () => {
    const role = await prisma.client.role.create({
      data: { name: `e2e-multi-${crypto.randomUUID()}`, tenantId, description: "v1" },
    });
    await prisma.client.role.update({
      where: { id: role.id },
      data: { description: "v2" },
    });
    await prisma.client.role.update({
      where: { id: role.id },
      data: { description: "v3" },
    });
    await prisma.client.role.delete({ where: { id: role.id }, hardDelete: true });

    const auditRows = await prisma.auditLog.findMany({
      where: { targetModel: "Role", targetId: role.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditRows).toHaveLength(4);
    expect(auditRows.map((r) => r.action)).toEqual(["CREATE", "UPDATE", "UPDATE", "DELETE"]);
  });

  // Iter-200 documents the architectural limitation reviewer-flagged
  // as G3: the remaining 5 default `auditableModels` (`Tenant`,
  // `TenantMember`, `RolePolicy`, `Policy`, `Permission`, `ApiKey`)
  // beyond `Role` are all tenant-id-LESS at the column level — the
  // audit extension's tenant-resolution chain
  // (`extractTenantIdFromRow(after) ?? extractTenantIdFromRow(data)
  // ?? resolveTenantId()`) returns null for these models because
  // AsyncLocalStorage's `runWithTenant` context does not propagate
  // across Prisma's worker pipeline (documented in
  // `prisma-extensions.ts:362-369`). The `emitAuditRow` helper
  // returns early on null `tenantId` (`prisma-extensions.ts:453-460`)
  // — by design, since the `audit_log.tenant_id` column is `NOT NULL`.
  // So the operator-listed models in `auditableModels` only emit when
  // the SQL row carries a `tenantId` column directly (only `Role` and
  // `TenantMember` from the default list satisfy that). Closing the
  // gap fully requires either (a) per-tenant Tenant/Policy/Permission
  // schemas (architectural shift) or (b) propagating the AsyncLocalStorage
  // through the Prisma extension pipeline. The sanity-check below
  // pins the smaller iter-200 fix: every entry in `auditableModels`
  // resolves to a real Prisma model + table — iter-200 caught that
  // `RoleAssignment` was a dangling entry (no schema model with that
  // name) and replaced it with `RolePolicy` (the real role↔policy
  // join table).

  it("the auditableModels list contains no dangling references — every name resolves to a real Prisma model (iter-200 G3 sanity)", async () => {
    // Iter-200 fix: `RoleAssignment` was listed in `auditableModels`
    // (and `MODEL_TABLE_MAP`) but no `RoleAssignment` model exists in
    // the schema — only `RolePolicy`. The audit extension's
    // `auditable.has(model)` check would never match for the dangling
    // entry, so its CUDs would silently emit no audit row despite
    // operator intent. Iter-200 replaced `RoleAssignment` →
    // `RolePolicy`. This test pins the invariant.
    const { MODEL_TABLE_MAP } = await import("../src/core/prisma/prisma.service.js");
    const tableNames = Object.values(MODEL_TABLE_MAP);
    const result = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      tableNames,
    );
    const presentTables = new Set(result.map((r) => r.table_name));
    for (const expectedTable of tableNames) {
      expect(presentTables.has(expectedTable)).toBe(true);
    }
  });
});
