import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../../src/core/app/bootstrap.js";
import { PrismaService } from "../../src/core/prisma/prisma.service.js";
import { uuidV7 } from "../../src/core/uuid/uuid-v7.js";
import {
  type ApiTestSession,
  createApiTestSession,
  ensureOrganizationMember,
  provisionApiTestTenant,
} from "../helpers/api-request.js";
import { pinHubTestAuthEnv } from "../helpers/hub-request.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · Hub outside development — `FEATURE_HUB_ENABLED=true` in production.
 *
 * The Dev-Hub has evolved into an operator console (CASL-gated via
 * `canAccessHub` / `canAccessTenantAdmin`). This story covers the opt-in
 * path: a production boot with `FEATURE_HUB_ENABLED=true` exposes the
 * OPERATIONAL tier to authenticated operators whose CASL ability grants
 * access — resolved through the real Better-Auth session + DB-backed
 * Role → RolePolicy → Policy → Permission chain. No `x-test-ability`
 * shortcuts anywhere in this file: production must never honour them,
 * and the positive cases must prove the real auth path.
 *
 * Tier contract under the flag:
 *   - operational surfaces → 200 for authorized operators
 *   - workstation surfaces → 404 for EVERYONE (dev-workstation-only)
 *   - unauthorized/unknown → 404 (mask; the surface stays undiscoverable)
 *   - anonymous            → same 401/302 the session wall produces today
 *
 * Lives in its own file so the worker boots ONE Nest app with
 * `NODE_ENV=production` set before bootstrap (same isolation rationale
 * as `hub-tunnel-production.e2e-spec.ts`).
 */
describe("Story · Hub outside development (production + FEATURE_HUB_ENABLED=true)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let httpServer: Parameters<typeof request>[0];
  let previousNodeEnv: string | undefined;
  let previousHubFlag: string | undefined;

  // Fresh per-run tenants so parallel workers on the shared testcontainer
  // never collide with the demo-seed tenant other specs use. Random v4
  // (not uuidV7): the test-org slug derives from the first 8 chars, and
  // v7 ids minted in the same millisecond share that prefix.
  const OPERATOR_TENANT = crypto.randomUUID();
  const MEMBER_TENANT = crypto.randomUUID();

  let operator: ApiTestSession;
  let plainMember: ApiTestSession;

  const cleanupPolicyIds: string[] = [];
  const cleanupRoleIds: string[] = [];

  beforeAll(async () => {
    pinHubTestAuthEnv();
    previousNodeEnv = process.env.NODE_ENV;
    previousHubFlag = process.env.FEATURE_HUB_ENABLED;
    process.env.NODE_ENV = "production";
    process.env.FEATURE_HUB_ENABLED = "true";
    process.env.SECRET_KEK_HEX ??= "0".repeat(64);
    process.env.SECRET_HMAC_HEX ??= "0".repeat(64);

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    httpServer = app.getHttpServer();

    // Operator: real sign-up/sign-in, org membership with role "owner",
    // and an explicit DB grant `read Hub` + CRUD `User` behind that role
    // name — the same chain a production deployment authors via seeds
    // or the admin console.
    operator = await createApiTestSession(httpServer);
    await ensureOrganizationMember(prisma, {
      organizationId: OPERATOR_TENANT,
      userId: operator.userId,
    });
    const roleId = uuidV7();
    const policyId = uuidV7();
    cleanupRoleIds.push(roleId);
    cleanupPolicyIds.push(policyId);
    await prisma.role.create({
      data: { id: roleId, name: "owner", tenantId: OPERATOR_TENANT },
    });
    await prisma.policy.create({
      data: { id: policyId, name: `hub-outside-dev-operator-${policyId}` },
    });
    await prisma.rolePolicy.create({ data: { roleId, policyId } });
    await prisma.permission.createMany({
      data: [
        { policyId, resource: "Hub", action: "READ", fields: [] },
        { policyId, resource: "User", action: "CREATE", fields: [] },
        { policyId, resource: "User", action: "READ", fields: [] },
        { policyId, resource: "User", action: "UPDATE", fields: [] },
        { policyId, resource: "User", action: "DELETE", fields: [] },
      ],
    });
    await provisionApiTestTenant(prisma, httpServer, operator, OPERATOR_TENANT);

    // Plain member: real session, org membership, but NO explicit role
    // rows — only the synthesized Member rules (Example, File, …), which
    // grant neither `read Hub` nor any tenant-admin subject.
    plainMember = await createApiTestSession(httpServer);
    await provisionApiTestTenant(prisma, httpServer, plainMember, MEMBER_TENANT);
  }, 120_000);

  afterAll(async () => {
    // Best-effort cleanup so re-runs against a reused DB stay deterministic.
    try {
      await prisma.permission.deleteMany({ where: { policyId: { in: cleanupPolicyIds } } });
      await prisma.rolePolicy.deleteMany({ where: { policyId: { in: cleanupPolicyIds } } });
      await prisma.policy.deleteMany({ where: { id: { in: cleanupPolicyIds } } });
      await prisma.role.deleteMany({ where: { id: { in: cleanupRoleIds } } });
    } catch {
      // cleanup must never fail the suite
    }
    await app.close();
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousHubFlag === undefined) delete process.env.FEATURE_HUB_ENABLED;
    else process.env.FEATURE_HUB_ENABLED = previousHubFlag;
    delete process.env.SECRET_KEK_HEX;
    delete process.env.SECRET_HMAC_HEX;
  });

  describe("anonymous requests (no session)", () => {
    it("JSON request without a session stays behind the session wall (401, as today)", async () => {
      const res = await request(httpServer).get("/hub/dashboard.json");
      expect(res.status).toBe(401);
    });

    it("browser navigation without a session redirects to the login page (302 /, as today)", async () => {
      const res = await request(httpServer).get("/hub").set("accept", "text/html");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });

    it("admin JSON without a session stays behind the session wall (401, as today)", async () => {
      const res = await request(httpServer).get("/admin/roles").set("accept", "application/json");
      expect(res.status).toBe(401);
    });

    it("new /hub/admin JSON without a session stays behind the session wall too", async () => {
      const res = await request(httpServer)
        .get("/hub/admin/roles")
        .set("accept", "application/json");
      expect(res.status).toBe(401);
    });
  });

  describe("authenticated session WITHOUT hub ability", () => {
    it("hub cockpit JSON responds 404 (masked — not 401/403)", async () => {
      const res = await plainMember.agent.get("/hub/dashboard.json");
      expect(res.status).toBe(404);
    });

    it("hub cockpit HTML responds 404 (no dev-style redirect — stays undiscoverable)", async () => {
      const res = await plainMember.agent.get("/hub").set("accept", "text/html");
      expect(res.status).toBe(404);
    });

    it("tenant-admin JSON responds 404 (masked)", async () => {
      const res = await plainMember.agent
        .get("/hub/admin/users/list.json")
        .set("accept", "application/json");
      expect(res.status).toBe(404);
    });

    it("admin CRUD responds 404 (masked)", async () => {
      const res = await plainMember.agent
        .get("/hub/admin/roles")
        .set("accept", "application/json");
      expect(res.status).toBe(404);
    });

    it("previously shell-open admin pages are masked too (rate-limits shell)", async () => {
      const res = await plainMember.agent
        .get("/hub/admin/rate-limits")
        .set("accept", "text/html");
      expect(res.status).toBe(404);
    });

    it("legacy /admin paths stay masked 404 — the 308 never leaks to unauthorized users", async () => {
      const json = await plainMember.agent.get("/admin/roles").set("accept", "application/json");
      expect(json.status).toBe(404);
      const shell = await plainMember.agent.get("/admin/rate-limits").set("accept", "text/html");
      expect(shell.status).toBe(404);
    });

    it("the access probe stays reachable for any signed-in user and reports no access", async () => {
      const res = await plainMember.agent.get("/hub/portal-access.json");
      expect(res.status).toBe(200);
      expect(res.body.hub).toBe(false);
      expect(res.body.tenantAdmin).toBe(false);
      // Even a no-access probe reports the tier signal, so the SPA never
      // has to guess the environment.
      expect(res.body.workstation).toBe(false);
    });
  });

  describe("authenticated session WITH hub ability (real DB grant)", () => {
    it("access probe reports hub + tenantAdmin", async () => {
      const res = await operator.agent.get("/hub/portal-access.json");
      expect(res.status).toBe(200);
      expect(res.body.hub).toBe(true);
      expect(res.body.tenantAdmin).toBe(true);
    });

    it("access probe reports workstation:false so the SPA hides dev-only nav", async () => {
      // The one signal the SPA was missing: outside development the
      // workstation tier is never servable, so the sidebar must not
      // offer Files/Migrations/Coverage/… — their data endpoints 404.
      const res = await operator.agent.get("/hub/portal-access.json");
      expect(res.status).toBe(200);
      expect(res.body.workstation).toBe(false);
    });

    it("palette search omits workstation-tier pages (nav parity)", async () => {
      const migrations = await operator.agent.get("/hub/palette/search.json?q=migrations");
      expect(migrations.status).toBe(200);
      const migrationHrefs = (migrations.body.pages as Array<{ href: string }>).map((p) => p.href);
      expect(migrationHrefs).not.toContain("/hub/migrations");
      const logs = await operator.agent.get("/hub/palette/search.json?q=logs");
      expect(logs.status).toBe(200);
      const logHrefs = (logs.body.pages as Array<{ href: string }>).map((p) => p.href);
      expect(logHrefs).toContain("/hub/logs");
    });

    it("hub SPA shell renders (200)", async () => {
      const res = await operator.agent.get("/hub").set("accept", "text/html");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
    });

    it("operational cockpit JSON responds 200 (dashboard)", async () => {
      const res = await operator.agent.get("/hub/dashboard.json");
      expect(res.status).toBe(200);
    });

    it("operational feature READ views respond 200", async () => {
      const features = await operator.agent.get("/hub/features.json");
      expect(features.status).toBe(200);
      const catalog = await operator.agent.get("/hub/feature-catalog.json");
      expect(catalog.status).toBe(200);
    });

    it("operational diagnostics respond 200 (logs + routes)", async () => {
      const logs = await operator.agent.get("/hub/logs.json");
      expect(logs.status).toBe(200);
      const routes = await operator.agent.get("/hub/routes.json");
      expect(routes.status).toBe(200);
    });

    it("tenant-admin CRUD responds 200 (roles list)", async () => {
      const res = await operator.agent.get("/hub/admin/roles").set("accept", "application/json");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("user admin JSON responds 200 (manage User grant)", async () => {
      const res = await operator.agent
        .get("/hub/admin/users/list.json")
        .set("accept", "application/json");
      expect(res.status).toBe(200);
    });

    it("admin SPA shells behind the CASL wall render (rate-limits shell)", async () => {
      const res = await operator.agent.get("/hub/admin/rate-limits").set("accept", "text/html");
      expect(res.status).toBe(200);
    });

    it("legacy /admin paths answer 308 to /hub/admin for the authorized operator", async () => {
      const roles = await operator.agent.get("/admin/roles").set("accept", "application/json");
      expect(roles.status).toBe(308);
      expect(roles.headers.location).toBe("/hub/admin/roles");
      const users = await operator.agent
        .get("/admin/users/list.json")
        .set("accept", "application/json");
      expect(users.status).toBe(308);
      expect(users.headers.location).toBe("/hub/admin/users/list.json");
    });
  });

  describe("workstation tier stays development-only — flag or not, ability or not", () => {
    it("source-tree file browser responds 404", async () => {
      const res = await operator.agent.get("/hub/files/tree.json");
      expect(res.status).toBe(404);
    });

    it("migrations runner responds 404", async () => {
      const res = await operator.agent.get("/hub/migrations.json");
      expect(res.status).toBe(404);
    });

    it("feature toggle WRITE (.env file update) responds 404", async () => {
      const res = await operator.agent
        .post("/hub/features/rateLimit/toggle")
        .send({ enabled: true });
      expect(res.status).toBe(404);
    });

    it("x-test-ability tester responds 404", async () => {
      const res = await operator.agent
        .get("/hub/admin/permissions/test.json")
        .set("accept", "application/json");
      expect(res.status).toBe(404);
      // The legacy path 308s for the authorized operator, but the
      // target still refuses the workstation tier — net result 404.
      const legacy = await operator.agent
        .get("/admin/permissions/test.json")
        .set("accept", "application/json");
      expect(legacy.status).toBe(308);
      expect(legacy.headers.location).toBe("/hub/admin/permissions/test.json");
    });

    it("workstation tunnel state responds 404", async () => {
      const res = await operator.agent.get("/hub/tunnel.json");
      expect(res.status).toBe(404);
    });

    it("coverage / test-summary artifacts respond 404", async () => {
      const coverage = await operator.agent.get("/hub/coverage.json");
      expect(coverage.status).toBe(404);
      const tests = await operator.agent.get("/hub/tests.json");
      expect(tests.status).toBe(404);
    });

    it("ERD (reads prisma schema from the repo tree) responds 404", async () => {
      const res = await operator.agent.get("/hub/erd.json");
      expect(res.status).toBe(404);
    });

    it("brand WRITE (repo file) responds 404", async () => {
      const res = await operator.agent.post("/hub/brand").send({});
      expect(res.status).toBe(404);
    });

    it("cross-tenant search tester responds 404", async () => {
      const res = await operator.agent
        .get("/hub/admin/search.json?q=probe")
        .set("accept", "application/json");
      expect(res.status).toBe(404);
    });
  });
});
