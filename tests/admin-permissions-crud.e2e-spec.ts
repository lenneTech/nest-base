import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Admin CRUD persistence (e2e) — iter-115. Validates the
 * `/admin/{roles, policies, permissions}` endpoints round-trip rows
 * through Prisma (replacing the in-memory implementation that lost
 * everything on restart).
 */
describe("Admin · Roles/Policies/Permissions CRUD persistence", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let sessionCookie: string;
  const originalEnv: Record<string, string | undefined> = {};
  // Per-suite SUITE_TAG prefix on policy names so concurrent specs
  // writing to the same `policies` / `permissions` / `role_policies`
  // tables cannot contaminate this spec's afterAll cleanup. Iter-196
  // hardening per the iter-194 shared-table-isolation rule
  // (`tests/CLAUDE.md` "Shared-table isolation under parallel
  // execution"); the prior global `deleteMany()` cleanups were
  // documented as harmless because no other e2e seeds these tables
  // today, but the per-suite prefix is the canonical pattern.
  const SUITE_TAG = `admin-perms-${crypto.randomUUID()}`;
  const policyName = (label: string) => `${SUITE_TAG}-${label}`;
  const policyFilter = { name: { startsWith: `${SUITE_TAG}-` } };

  function rememberEnv(key: string): void {
    originalEnv[key] = process.env[key];
  }

  beforeAll(async () => {
    rememberEnv("BETTER_AUTH_SECRET");
    rememberEnv("APP_BASE_URL");
    process.env.BETTER_AUTH_SECRET = "test-secret-32-chars-minimum-aaaaaaaa";
    process.env.APP_BASE_URL = "http://localhost:3000";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    // Organization.id is String in BA schema; use a UUID so Role.tenantId
    // (still @db.Uuid) remains compatible.
    tenantId = crypto.randomUUID();
    await prisma.organization.create({
      data: {
        id: tenantId,
        name: `admin-crud-${Date.now()}`,
        slug: `admin-crud-${tenantId}`,
        createdAt: new Date(),
      },
    });

    const email = `admin-crud-e2e-${Date.now()}@example.com`;
    const signUp = await request(app.getHttpServer())
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({ email, password: "password-12345", name: "Admin CRUD E2E" });
    if (signUp.status !== 200) {
      throw new Error(`sign-up failed (${signUp.status}): ${JSON.stringify(signUp.body)}`);
    }
    const setCookie = signUp.headers["set-cookie"];
    const cookies: string[] | undefined = Array.isArray(setCookie)
      ? (setCookie as string[])
      : typeof setCookie === "string"
        ? [setCookie]
        : undefined;
    sessionCookie = (cookies ?? []).map((c) => c.split(";")[0]).join("; ");
    const userId = signUp.body.user.id as string;
    // Create a BA member row so resolveRequestTenantId validates membership.
    await prisma.member.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        organizationId: tenantId,
        role: "owner",
        createdAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    try {
      // Filter cleanup to OUR rows: a) policies (filtered by SUITE_TAG
      // name prefix), b) permissions (cascade-deleted via the
      // matching policyId), c) rolePolicy (filtered via roleId or
      // policyId on OUR rows), d) roles (already filtered by tenantId).
      const ourPolicies = await prisma.policy.findMany({
        where: policyFilter,
        select: { id: true },
      });
      const policyIds = ourPolicies.map((p) => p.id);
      if (policyIds.length > 0) {
        await prisma.permission.deleteMany({ where: { policyId: { in: policyIds } } });
        await prisma.rolePolicy.deleteMany({ where: { policyId: { in: policyIds } } });
      }
      await prisma.policy.deleteMany({ where: policyFilter });
      await prisma.role.deleteMany({ where: { tenantId } });
      await prisma.member.deleteMany({ where: { organizationId: tenantId } });
      await prisma.organization.delete({ where: { id: tenantId } });
    } catch {
      // best-effort
    }
    await app.close();
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("persists a Role through POST /admin/roles → GET /admin/roles", async () => {
    const created = await request(app.getHttpServer())
      .post("/admin/roles")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ name: `role-${Date.now()}`, tenantId, description: "iter-115" });
    expect(created.status).toBe(201);
    expect(typeof created.body.id).toBe("string");
    const list = await request(app.getHttpServer())
      .get("/admin/roles")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(list.status).toBe(200);
    expect(list.body.some((r: { id: string }) => r.id === created.body.id)).toBe(true);
  });

  it("creates a Policy + Permission and links them via /admin/permissions/attach", async () => {
    const policy = await request(app.getHttpServer())
      .post("/admin/policies")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ name: policyName(`policy-${Date.now()}`), description: "test policy" });
    expect(policy.status).toBe(201);
    const role = await request(app.getHttpServer())
      .post("/admin/roles")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ name: `attach-role-${Date.now()}`, tenantId });
    expect(role.status).toBe(201);
    const perm = await request(app.getHttpServer())
      .post("/admin/permissions")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        policyId: policy.body.id,
        resource: "Article",
        action: "READ",
        fields: ["title", "body"],
      });
    expect(perm.status).toBe(201);
    expect(perm.body.resource).toBe("Article");

    const link = await request(app.getHttpServer())
      .post("/admin/permissions/attach")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ roleId: role.body.id, policyId: policy.body.id });
    expect(link.status).toBe(201);

    const detach = await request(app.getHttpServer())
      .delete(`/admin/permissions/attach/${role.body.id}/${policy.body.id}`)
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(detach.status).toBe(200);
    expect(detach.body.removed).toBe(true);
  });

  it("rejects an unknown action with 400", async () => {
    const policy = await request(app.getHttpServer())
      .post("/admin/policies")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ name: policyName(`policy-bad-${Date.now()}`) });
    expect(policy.status).toBe(201);
    const res = await request(app.getHttpServer())
      .post("/admin/permissions")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        policyId: policy.body.id,
        resource: "Article",
        action: "EXPLODE",
      });
    expect(res.status).toBe(400);
  });

  it("DELETE /admin/roles/:id removes the row", async () => {
    const created = await request(app.getHttpServer())
      .post("/admin/roles")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ name: `to-delete-${Date.now()}`, tenantId });
    const id = created.body.id as string;
    const removed = await request(app.getHttpServer())
      .delete(`/admin/roles/${id}`)
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(removed.status).toBe(200);
    expect(removed.body.removed).toBe(true);
    const after = await request(app.getHttpServer())
      .get(`/admin/roles/${id}`)
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(after.status).toBe(404);
  });

  it("400s on /admin/roles GET when x-tenant-id header is missing (iter-202 reviewer-G3 closure)", async () => {
    // Iter-202 closes the reviewer's G3: `RoleAdminController` now
    // requires the header at every read/write, mirroring the iter-201
    // `auditBrowserJson` defense-in-depth pattern.
    const res = await request(app.getHttpServer())
      .get("/admin/roles")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/x-tenant-id/i);
  });

  it("GET /admin/roles returns ONLY rows matching the x-tenant-id header — cross-tenant rows do NOT leak", async () => {
    // Insert a role under a DIFFERENT tenant directly via Prisma. The
    // GET /admin/roles call (with OUR x-tenant-id header) must not
    // include it, even though the same DB connection sees both rows.
    const otherId = crypto.randomUUID();
    const otherTenant = await prisma.organization.create({
      data: {
        id: otherId,
        name: `admin-crud-other-${otherId}`,
        slug: `admin-crud-other-${otherId}`,
        createdAt: new Date(),
      },
    });
    const otherRole = await prisma.role.create({
      data: { name: `other-leak-${crypto.randomUUID()}`, tenantId: otherTenant.id },
    });
    try {
      const res = await request(app.getHttpServer())
        .get("/admin/roles")
        .set("x-tenant-id", tenantId)
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full");
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(otherRole.id);
    } finally {
      await prisma.role.delete({ where: { id: otherRole.id } });
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("GET /admin/roles/:id from a different tenant 404s instead of leaking the row", async () => {
    // Iter-202: the per-id read uses `findFirst({ id, tenantId })` so
    // a probe for another tenant's UUID falls back to NotFound rather
    // than returning the row.
    const otherId2 = crypto.randomUUID();
    const otherTenant = await prisma.organization.create({
      data: {
        id: otherId2,
        name: `admin-crud-other-${otherId2}`,
        slug: `admin-crud-other2-${otherId2}`,
        createdAt: new Date(),
      },
    });
    const otherRole = await prisma.role.create({
      data: { name: `other-id-probe-${crypto.randomUUID()}`, tenantId: otherTenant.id },
    });
    try {
      const res = await request(app.getHttpServer())
        .get(`/admin/roles/${otherRole.id}`)
        .set("x-tenant-id", tenantId)
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full");
      expect(res.status).toBe(404);
    } finally {
      await prisma.role.delete({ where: { id: otherRole.id } });
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("POST /admin/roles rejects a body.tenantId that does not match the x-tenant-id header", async () => {
    // Defense-in-depth: a malicious / buggy operator could pass a
    // different tenantId in the body to escape their scope. Iter-202
    // surfaces a 400 instead of trusting body over header.
    const otherId3 = crypto.randomUUID();
    const otherTenant = await prisma.organization.create({
      data: {
        id: otherId3,
        name: `admin-crud-mismatch-${otherId3}`,
        slug: `admin-crud-mismatch-${otherId3}`,
        createdAt: new Date(),
      },
    });
    try {
      const res = await request(app.getHttpServer())
        .post("/admin/roles")
        .set("x-tenant-id", tenantId)
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full")
        .send({ name: `mismatch-${Date.now()}`, tenantId: otherTenant.id });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/tenantId/i);
    } finally {
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("DELETE /admin/roles/:id from a different tenant 404s without removing the row", async () => {
    // Cross-tenant DELETE attempt: must NOT remove the other tenant's
    // role. Iter-202's `deleteMany({id, tenantId})` returns count=0 →
    // 404 instead of touching the row.
    const otherId4 = crypto.randomUUID();
    const otherTenant = await prisma.organization.create({
      data: {
        id: otherId4,
        name: `admin-crud-delete-other-${otherId4}`,
        slug: `admin-crud-del-${otherId4}`,
        createdAt: new Date(),
      },
    });
    const otherRole = await prisma.role.create({
      data: { name: `other-delete-${crypto.randomUUID()}`, tenantId: otherTenant.id },
    });
    try {
      const res = await request(app.getHttpServer())
        .delete(`/admin/roles/${otherRole.id}`)
        .set("x-tenant-id", tenantId)
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full");
      expect(res.status).toBe(404);
      // Verify the row still exists.
      const stillThere = await prisma.role.findUnique({ where: { id: otherRole.id } });
      expect(stillThere).not.toBeNull();
    } finally {
      await prisma.role.delete({ where: { id: otherRole.id } });
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("400s on /admin/roles when x-tenant-id is not a valid UUID (iter-202 reviewer feedback)", async () => {
    const res = await request(app.getHttpServer())
      .get("/admin/roles")
      .set("x-tenant-id", "not-a-uuid")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/uuid/i);
  });

  it("/admin/permissions/attach refuses to attach a global Policy to a foreign tenant's Role (404)", async () => {
    // Create a Role in a DIFFERENT tenant directly via Prisma. The
    // attach handler now `findFirst({id: roleId, tenantId: ourTenant})`
    // so it surfaces a 404 instead of silently creating the link.
    const otherId5 = crypto.randomUUID();
    const otherTenant = await prisma.organization.create({
      data: {
        id: otherId5,
        name: `admin-attach-other-${otherId5}`,
        slug: `admin-attach-${otherId5}`,
        createdAt: new Date(),
      },
    });
    const otherRole = await prisma.role.create({
      data: { name: `attach-foreign-${crypto.randomUUID()}`, tenantId: otherTenant.id },
    });
    const policy = await request(app.getHttpServer())
      .post("/admin/policies")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({ name: policyName(`policy-attach-foreign-${Date.now()}`) });
    expect(policy.status).toBe(201);
    try {
      const attach = await request(app.getHttpServer())
        .post("/admin/permissions/attach")
        .set("x-tenant-id", tenantId)
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full")
        .send({ roleId: otherRole.id, policyId: policy.body.id });
      expect(attach.status).toBe(404);
      // Verify nothing was inserted.
      const link = await prisma.rolePolicy.findUnique({
        where: { roleId_policyId: { roleId: otherRole.id, policyId: policy.body.id } },
      });
      expect(link).toBeNull();
    } finally {
      await prisma.policy.delete({ where: { id: policy.body.id } });
      await prisma.role.delete({ where: { id: otherRole.id } });
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("/admin/permissions/attach DELETE refuses to detach a foreign tenant's Role link (404)", async () => {
    const otherId6 = crypto.randomUUID();
    const otherTenant = await prisma.organization.create({
      data: {
        id: otherId6,
        name: `admin-detach-other-${otherId6}`,
        slug: `admin-detach-${otherId6}`,
        createdAt: new Date(),
      },
    });
    const otherRole = await prisma.role.create({
      data: { name: `detach-foreign-${crypto.randomUUID()}`, tenantId: otherTenant.id },
    });
    const policy = await prisma.policy.create({
      data: { name: policyName(`policy-detach-foreign-${crypto.randomUUID()}`) },
    });
    const link = await prisma.rolePolicy.create({
      data: { roleId: otherRole.id, policyId: policy.id },
    });
    try {
      const res = await request(app.getHttpServer())
        .delete(`/admin/permissions/attach/${otherRole.id}/${policy.id}`)
        .set("x-tenant-id", tenantId)
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full");
      expect(res.status).toBe(404);
      // Verify the link survives.
      const stillThere = await prisma.rolePolicy.findUnique({
        where: { roleId_policyId: { roleId: link.roleId, policyId: link.policyId } },
      });
      expect(stillThere).not.toBeNull();
    } finally {
      await prisma.rolePolicy.delete({
        where: { roleId_policyId: { roleId: link.roleId, policyId: link.policyId } },
      });
      await prisma.policy.delete({ where: { id: policy.id } });
      await prisma.role.delete({ where: { id: otherRole.id } });
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("POST /admin/permissions/test 400s when x-tenant-id is missing", async () => {
    const res = await request(app.getHttpServer())
      .post("/admin/permissions/test")
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        userId: "00000000-0000-0000-0000-000000000099",
        tenantId,
        action: "read",
        subject: "Article",
      });
    expect(res.status).toBe(400);
  });

  it("POST /admin/permissions/test rejects body.tenantId mismatch with header", async () => {
    const otherId7 = crypto.randomUUID();
    const otherTenant = await prisma.organization.create({
      data: {
        id: otherId7,
        name: `admin-test-mismatch-${otherId7}`,
        slug: `admin-test-mm-${otherId7}`,
        createdAt: new Date(),
      },
    });
    try {
      const res = await request(app.getHttpServer())
        .post("/admin/permissions/test")
        .set("x-tenant-id", tenantId)
        .set("cookie", sessionCookie)
        .set("x-test-ability", "full")
        .send({
          userId: "00000000-0000-0000-0000-000000000099",
          tenantId: otherTenant.id,
          action: "read",
          subject: "Article",
        });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/tenantId/i);
    } finally {
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("POST /admin/permissions/test echoes (userId, tenantId, action, subject) + ability decision", async () => {
    const res = await request(app.getHttpServer())
      .post("/admin/permissions/test")
      .set("x-tenant-id", tenantId)
      .set("cookie", sessionCookie)
      .set("x-test-ability", "full")
      .send({
        userId: "00000000-0000-0000-0000-000000000099",
        tenantId,
        action: "read",
        subject: "Article",
      });
    expect(res.status).toBe(201);
    expect(res.body.request.userId).toBe("00000000-0000-0000-0000-000000000099");
    expect(res.body.request.subject).toBe("Article");
    expect(typeof res.body.can).toBe("boolean");
    expect(res.body.report.byResource).toBeDefined();
  });
});
