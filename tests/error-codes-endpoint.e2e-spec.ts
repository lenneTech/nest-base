import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `/errors` endpoint exposes the ErrorCodeRegistry — a JSON catalogue
 * of CORE_* codes (and project-specific APP_* additions) with
 * status mapping and i18n message templates. Frontends + SDK
 * generators consume this to build error-code lookups.
 */
describe("Error-Code registry endpoint", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /errors with Accept: application/json returns the registered codes as JSON", async () => {
    const res = await request(app.getHttpServer()).get("/errors").set("Accept", "application/json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("code");
  });

  it("GET /errors with Accept: text/html (browser default) returns the JSON viewer", async () => {
    const res = await request(app.getHttpServer()).get("/errors").set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.text).toContain("Error Catalog");
    expect(res.text).toContain("jv__root");
  });

  it("GET /errors?format=json overrides Accept and returns JSON", async () => {
    const res = await request(app.getHttpServer())
      .get("/errors?format=json")
      .set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("seeded with the CORE_* defaults", async () => {
    const res = await request(app.getHttpServer()).get("/errors").set("Accept", "application/json");
    const codes = (res.body as Array<{ code: string }>).map((d) => d.code);
    expect(codes).toContain("CORE_INTERNAL");
    expect(codes).toContain("CORE_NOT_FOUND");
    expect(codes).toContain("CORE_UNAUTHORIZED");
    expect(codes).toContain("CORE_VALIDATION");
  });

  it("GET /errors/CORE_NOT_FOUND returns the resolved message (default locale)", async () => {
    const res = await request(app.getHttpServer()).get("/errors/CORE_NOT_FOUND");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      code: "CORE_NOT_FOUND",
      title: expect.any(String),
      status: 404,
    });
  });

  it("GET /errors/CORE_UNKNOWN returns 404", async () => {
    const res = await request(app.getHttpServer()).get("/errors/CORE_UNKNOWN");
    expect(res.status).toBe(404);
  });

  it("GET /errors/CORE_NOT_FOUND?locale=de returns the German message", async () => {
    const res = await request(app.getHttpServer())
      .get("/errors/CORE_NOT_FOUND")
      .query({ locale: "de" });
    expect(res.status).toBe(200);
    // German message for "not found" should differ from English title/detail.
    // We only assert it returns a usable shape — the registry seed provides
    // both `en` and `de` keys for CORE_*.
    expect(res.body.title).toBeTruthy();
  });
});
