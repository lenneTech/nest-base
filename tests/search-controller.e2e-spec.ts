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

describe("SearchController · GET /search", () => {
  let app: INestApplication;
  let agent: Agent;
  const originalSearch = process.env.FEATURE_SEARCH_ENABLED;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.FEATURE_SEARCH_ENABLED = "true";
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

    if (originalSearch === undefined) delete process.env.FEATURE_SEARCH_ENABLED;
    else process.env.FEATURE_SEARCH_ENABLED = originalSearch;
  });

  it("403s when no ability is attached (CanGuard rejects empty ability)", async () => {
    const res = await agent.get("/api/search").query({ q: "hello" });
    expect(res.status).toBe(403);
  });

  it("returns an empty result set when no executors are registered (with test-ability seeded)", async () => {
    const res = await withApiTestAbility(agent.get("/api/search")).query({ q: "hello" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hits: [], total: 0 });
  });

  it("400s when q is missing", async () => {
    const res = await withApiTestAbility(agent.get("/api/search"));
    expect(res.status).toBe(400);
  });

  it("accepts a custom limit and an `only` allowlist", async () => {
    const res = await withApiTestAbility(agent.get("/api/search")).query({
      q: "foo",
      limit: "10",
      only: "users,projects",
    });
    expect(res.status).toBe(200);
    expect(res.body.hits).toEqual([]);
  }, 15_000);
});
