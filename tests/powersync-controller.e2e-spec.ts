import type { INestApplication } from "@nestjs/common";
import type { Agent } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaService } from "../src/core/prisma/prisma.service.js";
import {
  API_TEST_TENANT_ID,
  createApiTestSession,
  provisionApiTestTenant,
  withApiTestAbility,
} from "./helpers/api-request.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

describe("PowerSyncController · POST /powersync/crud", () => {
  let app: INestApplication;
  let agent: Agent;
  let previousPowerSyncFlag: string | undefined;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    previousPowerSyncFlag = process.env.FEATURE_POWERSYNC_ENABLED;
    process.env.FEATURE_POWERSYNC_ENABLED = "true";
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const prisma = app.get(PrismaService);
    const session = await createApiTestSession(app.getHttpServer(), {
      organizationId: API_TEST_TENANT_ID,
    });
    await provisionApiTestTenant(prisma, app.getHttpServer(), session, API_TEST_TENANT_ID);
    agent = session.agent;
  });

  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;

    if (previousPowerSyncFlag === undefined) delete process.env.FEATURE_POWERSYNC_ENABLED;
    else process.env.FEATURE_POWERSYNC_ENABLED = previousPowerSyncFlag;
  });

  it("403s when no ability is attached (CanGuard rejects empty ability)", async () => {
    const res = await agent
      .post("/api/powersync/crud")
      .send({ batch: [{ op: "PUT", type: "widgets", id: "w1", data: {} }] });
    expect(res.status).toBe(403);
  });

  it("accepts a valid batch and returns 204 (with test-ability seeded)", async () => {
    const res = await withApiTestAbility(agent.post("/api/powersync/crud")).send({
      batch: [{ op: "PUT", type: "widgets", id: "w1", data: { name: "foo" } }],
    });
    expect(res.status).toBe(204);
  });

  it("400s on a malformed batch (unknown op)", async () => {
    const res = await withApiTestAbility(agent.post("/api/powersync/crud")).send({
      batch: [{ op: "NUKE", type: "x", id: "y", data: {} }],
    });
    expect(res.status).toBe(400);
  });

  it("400s on missing batch field", async () => {
    const res = await withApiTestAbility(agent.post("/api/powersync/crud")).send({});
    expect(res.status).toBe(400);
  });
});
