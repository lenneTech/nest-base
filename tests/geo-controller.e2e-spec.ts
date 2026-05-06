import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

describe("GeoController · /geo/* + /places/nearby", () => {
  let app: INestApplication;
  let previousGeoFlag: string | undefined;
  let previousGeoProvider: string | undefined;

  beforeAll(async () => {
    previousGeoFlag = process.env.FEATURE_GEO_ENABLED;
    previousGeoProvider = process.env.FEATURE_GEO_PROVIDER;
    // Geo is opt-in (heap-budget gate SC.BOOT.09); turn it on BEFORE
    // dynamic-importing bootstrap so AppModule's top-level
    // `loadFeatures(process.env)` sees the flag.
    process.env.FEATURE_GEO_ENABLED = "true";
    // Iter-161 changed `geo.module.ts` to dispatch on
    // `features.geo.provider` (default = nominatim, which makes a
    // real HTTP call). Tests don't have network access — pin the
    // local-stub provider so the geocode/reverseGeocode paths
    // resolve to seeded fixtures (empty by default → returns null).
    process.env.FEATURE_GEO_PROVIDER = "local";
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
    if (previousGeoFlag === undefined) delete process.env.FEATURE_GEO_ENABLED;
    else process.env.FEATURE_GEO_ENABLED = previousGeoFlag;
    if (previousGeoProvider === undefined) delete process.env.FEATURE_GEO_PROVIDER;
    else process.env.FEATURE_GEO_PROVIDER = previousGeoProvider;
  });

  it("GET /geo/geocode 403s when no ability is attached", async () => {
    const res = await request(app.getHttpServer())
      .get("/geo/geocode")
      .set("x-tenant-id", TENANT)
      .query({ q: "Berlin" });
    expect(res.status).toBe(403);
  });

  it("GET /geo/geocode returns 200 with empty/null body when no fixture matches (with test-ability)", async () => {
    const res = await request(app.getHttpServer())
      .get("/geo/geocode")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full")
      .query({ q: "nonsense-place-12345" });
    expect(res.status).toBe(200);
    // LocalStub with empty seed returns null; supertest serialises it.
    const body = res.body as unknown;
    expect(
      body === null ||
        body === "" ||
        body === undefined ||
        (typeof body === "object" && Object.keys(body as object).length === 0),
    ).toBe(true);
  });

  it("GET /geo/geocode 400s when q is missing", async () => {
    const res = await request(app.getHttpServer())
      .get("/geo/geocode")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full");
    expect(res.status).toBe(400);
  });

  it("GET /geo/reverse-geocode validates lat/lng", async () => {
    const res = await request(app.getHttpServer())
      .get("/geo/reverse-geocode")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full")
      .query({ lat: "abc", lng: "xyz" });
    expect(res.status).toBe(400);
  });

  it("POST /places/nearby returns the SQL builder output for a valid request", async () => {
    const res = await request(app.getHttpServer())
      .post("/places/nearby")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full")
      .send({ lat: 52.5, lng: 13.4, radiusMeters: 1000 });
    expect(res.status).toBe(201);
    expect(res.body.sql).toMatch(/ST_DWithin/);
    expect(res.body.sql).toContain("addresses");
  });

  it("POST /places/nearby 400s on bad input (e.g. radius 0)", async () => {
    const res = await request(app.getHttpServer())
      .post("/places/nearby")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full")
      .send({ lat: 52.5, lng: 13.4, radiusMeters: 0 });
    expect(res.status).toBe(400);
  });

  it("POST /places/nearby 400s without an x-tenant-id header (iter-205 reviewer-G5)", async () => {
    const res = await request(app.getHttpServer())
      .post("/places/nearby")
      .set("x-test-ability", "full")
      .send({ lat: 52.5, lng: 13.4, radiusMeters: 1000 });
    expect(res.status).toBe(400);
    // The tenant-guard middleware fires before the controller and
    // surfaces "tenant header is required" — defense-in-depth: even
    // without the controller's explicit check, the upstream guard
    // already refuses the request. Iter-205 adds belt-and-braces by
    // also failing inside the handler if the middleware was somehow
    // skipped (e.g. an exempt path).
    expect(JSON.stringify(res.body)).toMatch(/tenant/i);
  });

  it("POST /places/nearby emitted SQL contains a tenantId predicate (iter-205 reviewer-G5)", async () => {
    const res = await request(app.getHttpServer())
      .post("/places/nearby")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full")
      .send({ lat: 52.5, lng: 13.4, radiusMeters: 1000 });
    expect(res.status).toBe(201);
    // The emitted SQL must scope by tenant before the spatial filter.
    expect(res.body.sql as string).toMatch(new RegExp(`"tenantId"\\s*=\\s*'${TENANT}'`));
    const tenantIdx = (res.body.sql as string).indexOf('"tenantId"');
    const dwithinIdx = (res.body.sql as string).indexOf("ST_DWithin");
    expect(tenantIdx).toBeGreaterThan(0);
    expect(tenantIdx).toBeLessThan(dwithinIdx);
  });
});
