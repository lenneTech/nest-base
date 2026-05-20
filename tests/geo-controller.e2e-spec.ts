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

describe("GeoController · /geo/* + /places/nearby", () => {
  let app: INestApplication;
  let agent: Agent;
  let previousGeoFlag: string | undefined;
  let previousGeoProvider: string | undefined;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    previousGeoFlag = process.env.FEATURE_GEO_ENABLED;
    previousGeoProvider = process.env.FEATURE_GEO_PROVIDER;
    process.env.FEATURE_GEO_ENABLED = "true";
    process.env.FEATURE_GEO_PROVIDER = "local";
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

    if (previousGeoFlag === undefined) delete process.env.FEATURE_GEO_ENABLED;
    else process.env.FEATURE_GEO_ENABLED = previousGeoFlag;
    if (previousGeoProvider === undefined) delete process.env.FEATURE_GEO_PROVIDER;
    else process.env.FEATURE_GEO_PROVIDER = previousGeoProvider;
  });

  it("GET /geo/geocode 403s when no ability is attached", async () => {
    const res = await agent.get("/api/geo/geocode").query({ q: "Berlin" });
    expect(res.status).toBe(403);
  });

  it("GET /geo/geocode returns 200 with empty/null body when no fixture matches (with test-ability)", async () => {
    const res = await withApiTestAbility(agent.get("/api/geo/geocode")).query({
      q: "nonsense-place-12345",
    });
    expect(res.status).toBe(200);
    const body = res.body as unknown;
    expect(
      body === null ||
        body === "" ||
        body === undefined ||
        (typeof body === "object" && Object.keys(body as object).length === 0),
    ).toBe(true);
  });

  it("GET /geo/geocode 400s when q is missing", async () => {
    const res = await withApiTestAbility(agent.get("/api/geo/geocode"));
    expect(res.status).toBe(400);
  });

  it("GET /geo/reverse-geocode validates lat/lng", async () => {
    const res = await withApiTestAbility(agent.get("/api/geo/reverse-geocode")).query({
      lat: "abc",
      lng: "xyz",
    });
    expect(res.status).toBe(400);
  });

  it("POST /places/nearby returns the SQL builder output for a valid request", async () => {
    const res = await withApiTestAbility(agent.post("/api/places/nearby")).send({
      lat: 52.5,
      lng: 13.4,
      radiusMeters: 1000,
    });
    expect(res.status).toBe(201);
    expect(res.body.sql).toMatch(/ST_DWithin/);
    expect(res.body.sql).toContain("addresses");
  });

  it("POST /places/nearby 400s on bad input (e.g. radius 0)", async () => {
    const res = await withApiTestAbility(agent.post("/api/places/nearby")).send({
      lat: 52.5,
      lng: 13.4,
      radiusMeters: 0,
    });
    expect(res.status).toBe(400);
  });

  it("POST /places/nearby 400s without active organization in session", async () => {
    const bareSession = await createApiTestSession(app.getHttpServer());
    const res = await withApiTestAbility(bareSession.agent.post("/api/places/nearby")).send({
      lat: 52.5,
      lng: 13.4,
      radiusMeters: 1000,
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/tenant/i);
  });

  it("POST /places/nearby emitted SQL contains a tenantId predicate (iter-205 reviewer-G5)", async () => {
    const res = await withApiTestAbility(agent.post("/api/places/nearby")).send({
      lat: 52.5,
      lng: 13.4,
      radiusMeters: 1000,
    });
    expect(res.status).toBe(201);
    expect(res.body.sql as string).toMatch(
      new RegExp(`"tenantId"\\s*=\\s*'${API_TEST_TENANT_ID}'`),
    );
    const tenantIdx = (res.body.sql as string).indexOf('"tenantId"');
    const dwithinIdx = (res.body.sql as string).indexOf("ST_DWithin");
    expect(tenantIdx).toBeGreaterThan(0);
    expect(tenantIdx).toBeLessThan(dwithinIdx);
  });
});
