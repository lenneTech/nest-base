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
 * Story · Hub outside development — flag OFF (backward-compat baseline).
 *
 * `FEATURE_HUB_ENABLED` unset in a production boot must preserve today's
 * behaviour byte-for-byte:
 *   - every dev-asserted hub/admin route 404s — even for a session whose
 *     DB grant WOULD authorize it (the flag gates, not the ability)
 *   - anonymous requests hit the same session wall as before (401/302)
 *   - the pre-existing @Can-gated admin surfaces that were ALREADY
 *     reachable in production (user admin JSON, admin SPA shells) stay
 *     reachable — this PR must not silently remove them
 *
 * One production boot per file (see hub-tunnel-production.e2e-spec.ts
 * for the NODE_ENV-per-worker rationale).
 */
describe("Story · Hub outside development (production, FEATURE_HUB_ENABLED unset)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let httpServer: Parameters<typeof request>[0];
  let previousNodeEnv: string | undefined;
  let previousHubFlag: string | undefined;

  // Random v4 (not uuidV7): the helper's test-org slug derives from the
  // first 8 chars, and v7 ids minted in the same millisecond share that
  // prefix — colliding slugs would silently skip the org insert.
  const OPERATOR_TENANT = crypto.randomUUID();
  let operator: ApiTestSession;

  const cleanupPolicyIds: string[] = [];
  const cleanupRoleIds: string[] = [];

  beforeAll(async () => {
    pinHubTestAuthEnv();
    previousNodeEnv = process.env.NODE_ENV;
    previousHubFlag = process.env.FEATURE_HUB_ENABLED;
    process.env.NODE_ENV = "production";
    delete process.env.FEATURE_HUB_ENABLED;
    process.env.SECRET_KEK_HEX ??= "0".repeat(64);
    process.env.SECRET_HMAC_HEX ??= "0".repeat(64);

    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    prisma = app.get(PrismaService);
    httpServer = app.getHttpServer();

    // A fully-granted operator (read Hub + CRUD User) — proves the 404s
    // below come from the missing flag, not from a missing ability.
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
      data: { id: policyId, name: `hub-outside-dev-flag-off-${policyId}` },
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
  }, 120_000);

  afterAll(async () => {
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

  describe("hub/admin surfaces stay 404 — even for a granted operator", () => {
    it("hub SPA shell 404s", async () => {
      const res = await operator.agent.get("/hub").set("accept", "text/html");
      expect(res.status).toBe(404);
    });

    it("operational cockpit JSON 404s", async () => {
      const res = await operator.agent.get("/hub/dashboard.json");
      expect(res.status).toBe(404);
    });

    it("access probe 404s", async () => {
      const res = await operator.agent.get("/hub/portal-access.json");
      expect(res.status).toBe(404);
    });

    it("admin CRUD 404s", async () => {
      const res = await operator.agent.get("/admin/roles").set("accept", "application/json");
      expect(res.status).toBe(404);
    });

    it("workstation surfaces 404 (unchanged)", async () => {
      const files = await operator.agent.get("/hub/files/tree.json");
      expect(files.status).toBe(404);
      const migrations = await operator.agent.get("/hub/migrations.json");
      expect(migrations.status).toBe(404);
      const toggle = await operator.agent
        .post("/hub/features/rateLimit/toggle")
        .send({ enabled: true });
      expect(toggle.status).toBe(404);
    });
  });

  describe("anonymous surface is byte-identical to the flag-on boot", () => {
    it("JSON without a session → 401 (session wall, not a hub-specific signal)", async () => {
      const res = await request(httpServer).get("/hub/dashboard.json");
      expect(res.status).toBe(401);
    });

    it("browser navigation without a session → 302 to /", async () => {
      const res = await request(httpServer).get("/hub").set("accept", "text/html");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });
  });

  describe("pre-existing @Can-gated admin surfaces stay reachable (no silent removals)", () => {
    it("user admin JSON stays 200 for a manage-User grant (today's production behaviour)", async () => {
      const res = await operator.agent
        .get("/admin/users/list.json")
        .set("accept", "application/json");
      expect(res.status).toBe(200);
    });

    it("admin SPA shells that never had a dev assert stay reachable (users shell)", async () => {
      const res = await operator.agent.get("/admin/users").set("accept", "text/html");
      expect(res.status).toBe(200);
    });
  });
});
