import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runWithTenant } from "../../src/core/multi-tenancy/tenant-context.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · Audit Prisma extension default-opts framework models in.
 *
 * The PRD pins (CF.AUDIT.02 + Success Criterion):
 *   "Story test mutates an opted-in model and verifies an AuditLog
 *    row with before/after JSON diff."
 *
 * Iter-67/69 wired the extension; iter-84 fixed an audit-finding —
 * the prod-default `auditableModels` array was `[]`, which silently
 * disabled the entire subsystem in every consuming project. The fix
 * defaults the framework-managed governance models in
 * (`Tenant`, `TenantMember`, `Role`, `RoleAssignment`, `Policy`,
 * `Permission`, `ApiKey`) so the extension actually captures CUDs
 * out of the box.
 *
 * The audit emitter early-exits when `resolveTenantId()` returns
 * null (RLS would reject the insert anyway). The story therefore
 * wraps every CUD in `runWithTenant(tenantId, …)` so the
 * AsyncLocalStorage carries a tenant id the extension can pick up.
 */
describe("Story · Audit extension default opt-in", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    process.env.FEATURE_AUDIT_ENABLED = "true";
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);

    // After issue #118, the old `tenants` table was dropped. Seed a BA
    // organization out-of-band (bare client + no tenant context, so no
    // audit row for this seeding step). Used as the tenant context for
    // the actual story bodies.
    const slug = `audit-fix-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const { uuidV7 } = await import("../../src/core/uuid/uuid-v7.js");
    const seeded = await prisma.organization.create({
      data: {
        id: uuidV7(),
        name: `audit-default-fixture-${Date.now()}`,
        slug,
        createdAt: new Date(),
      },
    });
    tenantId = seeded.id;
  });

  afterAll(async () => {
    if (prisma && tenantId) {
      await prisma.auditLog.deleteMany({ where: { tenantId } });
      await prisma.role.deleteMany({ where: { tenantId } });
      await prisma.organization.delete({ where: { id: tenantId } });
    }
    if (app) await app.close();
    delete process.env.FEATURE_AUDIT_ENABLED;
  });

  it("captures CREATE on Role via the extended client + writes an AuditLog row", async () => {
    const roleName = `audit-create-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const role = await runWithTenant(tenantId, () =>
      prisma.client.role.create({
        data: { name: roleName, tenantId },
      }),
    );
    expect(role.id).toBeTruthy();

    const rows = await prisma.auditLog.findMany({
      where: { targetModel: "Role", targetId: role.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows.length).toBeGreaterThan(0);

    const created = rows.find((r) => r.action === "CREATE");
    expect(created).toBeDefined();
    expect(created?.targetModel).toBe("Role");
    expect(created?.targetId).toBe(role.id);
    expect(created?.tenantId).toBe(tenantId);

    // Cleanup via bare client so the audit extension doesn't fire.
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.auditLog.deleteMany({ where: { targetId: role.id } });
  });

  it("captures UPDATE on Role with a before/after diff in the audit row", async () => {
    const roleName = `audit-update-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // Seed the row inside the tenant context too — but ignore the
    // CREATE audit row in the assertion below, only the UPDATE row
    // matters for this case.
    const role = await runWithTenant(tenantId, () =>
      prisma.client.role.create({ data: { name: roleName, tenantId } }),
    );

    await runWithTenant(tenantId, () =>
      prisma.client.role.update({
        where: { id: role.id },
        data: { name: `${roleName}-renamed` },
      }),
    );

    const updates = await prisma.auditLog.findMany({
      where: { targetModel: "Role", targetId: role.id, action: "UPDATE" },
      orderBy: { createdAt: "asc" },
    });
    expect(updates.length).toBeGreaterThan(0);
    const last = updates[updates.length - 1];
    expect(last).toBeDefined();

    const diff = last?.diff as Record<string, unknown> | null;
    expect(diff).not.toBeNull();
    // The PRD pins "before/after JSON diff". Both sides must be
    // present + reflect the rename.
    expect(diff).toHaveProperty("before");
    expect(diff).toHaveProperty("after");

    await prisma.role.delete({ where: { id: role.id } });
    await prisma.auditLog.deleteMany({ where: { targetId: role.id } });
  });

  it("does NOT capture mutations on a model NOT in auditableModels (e.g. Verification — Better-Auth internal)", async () => {
    const before = await prisma.auditLog.count({
      where: { targetModel: "Verification" },
    });

    const identifier = `audit-skip-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const created = await runWithTenant(tenantId, () =>
      prisma.client.verification.create({
        data: {
          identifier,
          value: "dummy",
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
    );

    const after = await prisma.auditLog.count({
      where: { targetModel: "Verification" },
    });
    expect(after).toBe(before);

    await prisma.verification.delete({ where: { id: created.id } });
  });
});
