import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

describe("SearchController · GET /search", () => {
  let app: INestApplication;
  const originalSearch = process.env.FEATURE_SEARCH_ENABLED;

  beforeAll(async () => {
    process.env.FEATURE_SEARCH_ENABLED = "true";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
    if (originalSearch === undefined) delete process.env.FEATURE_SEARCH_ENABLED;
    else process.env.FEATURE_SEARCH_ENABLED = originalSearch;
  });

  it("403s when no ability is attached (CanGuard rejects empty ability)", async () => {
    const res = await request(app.getHttpServer())
      .get("/search")
      .set("x-tenant-id", TENANT)
      .query({ q: "hello" });
    expect(res.status).toBe(403);
  });

  it("returns an empty result set when no executors are registered (with test-ability seeded)", async () => {
    const res = await request(app.getHttpServer())
      .get("/search")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full")
      .query({ q: "hello" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hits: [], total: 0 });
  });

  it("400s when q is missing", async () => {
    const res = await request(app.getHttpServer())
      .get("/search")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full");
    expect(res.status).toBe(400);
  });

  it("accepts a custom limit and an `only` allowlist", async () => {
    const res = await request(app.getHttpServer())
      .get("/search")
      .set("x-tenant-id", TENANT)
      .set("x-test-ability", "full")
      .query({ q: "foo", limit: "10", only: "users,projects" });
    expect(res.status).toBe(200);
    expect(res.body.hits).toEqual([]);
  });
});
