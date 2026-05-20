import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { hubReqScoped, pinHubTestAuthEnv } from "./helpers/hub-request.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `/hub/migrations` controller wiring (Issue #10).
 *
 * Same pattern as `hub.e2e-spec.ts`: development boot exposes the
 * page + JSON; production boot returns 404 on every endpoint.
 *
 * The endpoints that mutate the database (deploy / apply-one /
 * dry-run / retry / create / apply-draft / discard-draft) are tested
 * via shape only — actually applying/creating migrations against the
 * testcontainer would require pre-seeding pending migrations and is
 * deferred to a follow-up integration spec. The lock-gating + 400
 * validation paths are covered here.
 */
describe("Hub · /hub/migrations", () => {
  describe("in development mode", () => {
    let app: INestApplication;
    let hub: Awaited<ReturnType<typeof hubReqScoped>>;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      pinHubTestAuthEnv();
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
      hub = await hubReqScoped(app, TENANT);
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /hub/migrations serves the SPA shell with the correct title", async () => {
      const res = await hub.get("/hub/migrations");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("Migrations — nest-server");
    });

    it("GET /hub/migrations.json returns applied + pending + drift snapshot", async () => {
      const res = await hub.get("/hub/migrations.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.applied)).toBe(true);
      expect(Array.isArray(res.body.pending)).toBe(true);
      expect(Array.isArray(res.body.failed)).toBe(true);
      expect(typeof res.body.driftDetected).toBe("boolean");
      expect(Array.isArray(res.body.driftReasons)).toBe(true);
      expect(typeof res.body.migrationsRoot).toBe("string");
      // Test container ran `migrate deploy` in global-setup, so every
      // migration on disk should be applied. Pending stays empty.
      expect(res.body.pending).toEqual([]);
      // Applied list contains at least the init migration.
      expect(
        res.body.applied.some((m: { migration_name: string }) => m.migration_name.includes("init")),
      ).toBe(true);
    });

    it("GET /hub/migrations/preview/:name returns the SQL for an applied migration", async () => {
      // Pick a known migration that ships with the repo
      const name = "20260508000000_init";
      const res = await hub.get(`/hub/migrations/preview/${name}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(name);
      expect(typeof res.body.sql).toBe("string");
      expect(res.body.sql).toContain("CREATE");
    });

    it("GET /hub/migrations/preview/:name rejects path-traversal names with 400", async () => {
      const res = await hub.get("/hub/migrations/preview/..%2F..%2Fetc%2Fpasswd");
      expect(res.status).toBe(400);
    });

    it("POST /hub/migrations/apply-one rejects an invalid name with 400", async () => {
      const res = await hub.post("/hub/migrations/apply-one").send({ name: "../../../etc/passwd" });
      expect(res.status).toBe(400);
    });

    it("POST /hub/migrations/apply-one requires body.name", async () => {
      const res = await hub.post("/hub/migrations/apply-one").send({});
      expect(res.status).toBe(400);
    });

    it("POST /hub/migrations/dry-run rejects a malformed name", async () => {
      const res = await hub.post("/hub/migrations/dry-run").send({ name: "no-timestamp-prefix" });
      expect(res.status).toBe(400);
    });

    it("POST /hub/migrations/create rejects names with capitals or special chars", async () => {
      const res = await hub.post("/hub/migrations/create").send({ name: "AddTable!" });
      expect(res.status).toBe(400);
    });

    it("DELETE /hub/migrations/draft/:name rejects path-traversal", async () => {
      const res = await hub.delete("/hub/migrations/draft/..%2F..%2Fetc%2Fpasswd");
      expect(res.status).toBe(400);
    });

    it("GET /hub/migrations/diff returns a structured response", async () => {
      const res = await hub.get("/hub/migrations/diff");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(typeof res.body.success).toBe("boolean");
      expect(typeof res.body.sql).toBe("string");
      expect(typeof res.body.stderr).toBe("string");
    });
  });

  describe("outside development mode", () => {
    let app: INestApplication;
    let hub: Awaited<ReturnType<typeof hubReqScoped>>;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      pinHubTestAuthEnv();
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
      hub = await hubReqScoped(app, TENANT);
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /hub/migrations returns 404 in production", async () => {
      const res = await hub.get("/hub/migrations");
      expect(res.status).toBe(404);
    });

    it("GET /hub/migrations.json returns 404 in production", async () => {
      const res = await hub.get("/hub/migrations.json");
      expect(res.status).toBe(404);
    });

    it("POST /hub/migrations/deploy returns 404 in production", async () => {
      const res = await hub.post("/hub/migrations/deploy");
      expect(res.status).toBe(404);
    });

    it("POST /hub/migrations/apply-one returns 404 in production", async () => {
      const res = await hub.post("/hub/migrations/apply-one").send({ name: "20260508000000_init" });
      expect(res.status).toBe(404);
    });

    it("POST /hub/migrations/create returns 404 in production", async () => {
      const res = await hub.post("/hub/migrations/create").send({ name: "test-feature" });
      expect(res.status).toBe(404);
    });

    it("DELETE /hub/migrations/draft/:name returns 404 in production", async () => {
      const res = await hub.delete("/hub/migrations/draft/20260508000000_init");
      expect(res.status).toBe(404);
    });
  });
});
