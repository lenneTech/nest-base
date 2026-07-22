import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { PrismaService } from "../src/core/prisma/prisma.service.js";
import {
  createApiTestSession,
  provisionApiTestTenant,
  type ApiTestSession,
} from "./helpers/api-request.js";
const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Admin CRUD persistence (e2e) — iter-115. Validates the
 * `/hub/admin/{roles, policies, permissions}` endpoints round-trip rows
 * through Prisma (replacing the in-memory implementation that lost
 * everything on restart).
 */
describe("Admin · Roles/Policies/Permissions CRUD persistence", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let session: ApiTestSession;
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
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
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

    session = await createApiTestSession(app.getHttpServer(), {
      organizationId: tenantId,
      email: `admin-crud-e2e-${Date.now()}@example.com`,
      name: "Admin CRUD E2E",
    });
    await provisionApiTestTenant(prisma, app.getHttpServer(), session, tenantId);
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

  it("persists a Role through POST /hub/admin/roles → GET /hub/admin/roles", async () => {
    const created = await session.agent
      .post("/hub/admin/roles")

      .set("x-test-ability", "full")
      .send({ name: `role-${Date.now()}`, tenantId, description: "iter-115" });
    expect(created.status).toBe(201);
    expect(typeof created.body.id).toBe("string");
    const list = await session.agent
      .get("/hub/admin/roles")

      .set("x-test-ability", "full");
    expect(list.status).toBe(200);
    expect(list.body.some((r: { id: string }) => r.id === created.body.id)).toBe(true);
  });

  it("creates a Policy + Permission and links them via /hub/admin/permissions/attach", async () => {
    const policy = await session.agent
      .post("/hub/admin/policies")

      .set("x-test-ability", "full")
      .send({ name: policyName(`policy-${Date.now()}`), description: "test policy" });
    expect(policy.status).toBe(201);
    const role = await session.agent
      .post("/hub/admin/roles")

      .set("x-test-ability", "full")
      .send({ name: `attach-role-${Date.now()}`, tenantId });
    expect(role.status).toBe(201);
    const perm = await session.agent
      .post("/hub/admin/permissions")

      .set("x-test-ability", "full")
      .send({
        policyId: policy.body.id,
        resource: "Article",
        action: "READ",
        fields: ["title", "body"],
      });
    expect(perm.status).toBe(201);
    expect(perm.body.resource).toBe("Article");

    const link = await session.agent
      .post("/hub/admin/permissions/attach")

      .set("x-test-ability", "full")
      .send({ roleId: role.body.id, policyId: policy.body.id });
    expect(link.status).toBe(201);

    const matrix = await session.agent
      .get("/hub/admin/permissions/matrix.json")

      .set("x-test-ability", "full");
    expect(matrix.status).toBe(200);
    expect(matrix.body.resources).toContain("Article");
    expect(matrix.body.roleIds).toContain(role.body.id);
    expect(matrix.body.matrix.Article[role.body.id].actions).toContain("READ");

    const detach = await session.agent
      .delete(`/hub/admin/permissions/attach/${role.body.id}/${policy.body.id}`)

      .set("x-test-ability", "full");
    expect(detach.status).toBe(200);
    expect(detach.body.removed).toBe(true);
  });

  it("rejects an unknown action with 400", async () => {
    const policy = await session.agent
      .post("/hub/admin/policies")

      .set("x-test-ability", "full")
      .send({ name: policyName(`policy-bad-${Date.now()}`) });
    expect(policy.status).toBe(201);
    const res = await session.agent
      .post("/hub/admin/permissions")

      .set("x-test-ability", "full")
      .send({
        policyId: policy.body.id,
        resource: "Article",
        action: "EXPLODE",
      });
    expect(res.status).toBe(400);
  });

  it("DELETE /hub/admin/roles/:id removes the row", async () => {
    const created = await session.agent
      .post("/hub/admin/roles")

      .set("x-test-ability", "full")
      .send({ name: `to-delete-${Date.now()}`, tenantId });
    const id = created.body.id as string;
    const removed = await session.agent
      .delete(`/hub/admin/roles/${id}`)

      .set("x-test-ability", "full");
    expect(removed.status).toBe(200);
    expect(removed.body.removed).toBe(true);
    const after = await session.agent
      .get(`/hub/admin/roles/${id}`)

      .set("x-test-ability", "full");
    expect(after.status).toBe(404);
  });

  it("400s on /hub/admin/roles GET when session has no active organization", async () => {
    const agent = request.agent(app.getHttpServer());
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({
        email: `admin-crud-no-org-${Date.now()}@example.com`,
        password: "password-12345",
        name: "No Org",
      });
    expect(signUp.status).toBe(200);
    const res = await agent.get("/hub/admin/roles").set("x-test-ability", "full");
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/tenant/i);
  });

  it("GET /hub/admin/roles returns ONLY rows for the active session org — cross-tenant rows do NOT leak", async () => {
    // Insert a role under a DIFFERENT tenant directly via Prisma. The
    // GET /hub/admin/roles call (with OUR session tenant) must not
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
      const res = await session.agent
        .get("/hub/admin/roles")

        .set("x-test-ability", "full");
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
      expect(ids).not.toContain(otherRole.id);
    } finally {
      await prisma.role.delete({ where: { id: otherRole.id } });
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("GET /hub/admin/roles/:id from a different tenant 404s instead of leaking the row", async () => {
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
      const res = await session.agent
        .get(`/hub/admin/roles/${otherRole.id}`)

        .set("x-test-ability", "full");
      expect(res.status).toBe(404);
    } finally {
      await prisma.role.delete({ where: { id: otherRole.id } });
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("POST /hub/admin/roles rejects a body.tenantId that does not match the session tenant", async () => {
    // Defense-in-depth: body.tenantId must match ALS tenant from set-active.
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
      const res = await session.agent
        .post("/hub/admin/roles")

        .set("x-test-ability", "full")
        .send({ name: `mismatch-${Date.now()}`, tenantId: otherTenant.id });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(/tenantId/i);
    } finally {
      await prisma.organization.delete({ where: { id: otherTenant.id } });
    }
  });

  it("DELETE /hub/admin/roles/:id from a different tenant 404s without removing the row", async () => {
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
      const res = await session.agent
        .delete(`/hub/admin/roles/${otherRole.id}`)

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

  it("GET /hub/admin/roles succeeds with session tenant even when a stray x-tenant-id header is malformed", async () => {
    const res = await session.agent
      .get("/hub/admin/roles")
      .set("x-tenant-id", "not-a-uuid")
      .set("x-test-ability", "full");
    expect(res.status).toBe(200);
  });

  it("/hub/admin/permissions/attach refuses to attach a global Policy to a foreign tenant's Role (404)", async () => {
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
    const policy = await session.agent
      .post("/hub/admin/policies")

      .set("x-test-ability", "full")
      .send({ name: policyName(`policy-attach-foreign-${Date.now()}`) });
    expect(policy.status).toBe(201);
    try {
      const attach = await session.agent
        .post("/hub/admin/permissions/attach")

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

  it("/hub/admin/permissions/attach DELETE refuses to detach a foreign tenant's Role link (404)", async () => {
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
      const res = await session.agent
        .delete(`/hub/admin/permissions/attach/${otherRole.id}/${policy.id}`)

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

  it("POST /hub/admin/permissions/test 400s when session has no active organization", async () => {
    const agent = request.agent(app.getHttpServer());
    const signUp = await agent
      .post("/api/auth/sign-up/email")
      .set("content-type", "application/json")
      .send({
        email: `admin-perm-test-no-org-${Date.now()}@example.com`,
        password: "password-12345",
        name: "Perm Test No Org",
      });
    expect(signUp.status).toBe(200);
    const res = await agent.post("/hub/admin/permissions/test").set("x-test-ability", "full").send({
      userId: "00000000-0000-0000-0000-000000000099",
      tenantId,
      action: "read",
      subject: "Article",
    });
    expect(res.status).toBe(400);
  });

  it("POST /hub/admin/permissions/test rejects body.tenantId mismatch with session tenant", async () => {
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
      const res = await session.agent
        .post("/hub/admin/permissions/test")

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

  it("POST /hub/admin/permissions/test echoes (userId, tenantId, action, subject) + ability decision", async () => {
    const res = await session.agent
      .post("/hub/admin/permissions/test")

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
