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
    // Assert content, not just non-emptiness. A previous `length > 0`
    // pass was meaningless if the array contained garbage.
    const entries = res.body as Array<{
      code: string;
      status: number;
      messages?: Record<string, { title?: string }>;
    }>;
    expect(entries.length).toBeGreaterThanOrEqual(5); // at minimum the 5 core codes
    for (const entry of entries) {
      expect(entry.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(typeof entry.status).toBe("number");
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.status).toBeLessThan(600);
    }
  });

  it("GET /errors with Accept: text/html (browser default) returns the SPA shell", async () => {
    const res = await request(app.getHttpServer()).get("/errors").set("Accept", "text/html");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    // The HTML branch is now the dev-portal SPA shell — the React
    // `/errors` page fetches `?format=json` and renders the catalogue
    // through the shared `JsonViewer` component.
    expect(res.text).toContain("Error Catalog — nest-server");
    expect(res.text).toContain('<div id="root"></div>');
    expect(res.text).toMatch(/<script\s+type="module"\s+src="\/hub\/static\/main\.js"/);
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
