import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

describe("GeoController · /geo/* + /places/nearby", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
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
});
