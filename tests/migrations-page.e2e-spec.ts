import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * `/dev/migrations` controller wiring (Issue #10).
 *
 * Same pattern as `dev-hub.e2e-spec.ts`: development boot exposes the
 * page + JSON; production boot returns 404 on every endpoint.
 *
 * The endpoints that mutate the database (deploy / apply-one /
 * dry-run / retry / create / apply-draft / discard-draft) are tested
 * via shape only — actually applying/creating migrations against the
 * testcontainer would require pre-seeding pending migrations and is
 * deferred to a follow-up integration spec. The lock-gating + 400
 * validation paths are covered here.
 */
describe("Dev-Hub · /dev/migrations", () => {
  describe("in development mode", () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env.NODE_ENV = "development";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
    });

    it("GET /dev/migrations serves the SPA shell with the correct title", async () => {
      const res = await request(app.getHttpServer()).get("/dev/migrations");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toContain("Migrations — nest-server");
    });

    it("GET /dev/migrations.json returns applied + pending + drift snapshot", async () => {
      const res = await request(app.getHttpServer()).get("/dev/migrations.json");
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
      // Applied list contains at least the init schema migration.
      expect(
        res.body.applied.some((m: { migration_name: string }) =>
          m.migration_name.includes("init_schema"),
        ),
      ).toBe(true);
    });

    it("GET /dev/migrations/preview/:name returns the SQL for an applied migration", async () => {
      // Pick a known migration that ships with the repo
      const name = "20260428000050_init_schema";
      const res = await request(app.getHttpServer()).get(`/dev/migrations/preview/${name}`);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe(name);
      expect(typeof res.body.sql).toBe("string");
      expect(res.body.sql).toContain("CREATE");
    });

    it("GET /dev/migrations/preview/:name rejects path-traversal names with 400", async () => {
      const res = await request(app.getHttpServer()).get(
        "/dev/migrations/preview/..%2F..%2Fetc%2Fpasswd",
      );
      expect(res.status).toBe(400);
    });

    it("POST /dev/migrations/apply-one rejects an invalid name with 400", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/migrations/apply-one")
        .send({ name: "../../../etc/passwd" });
      expect(res.status).toBe(400);
    });

    it("POST /dev/migrations/apply-one requires body.name", async () => {
      const res = await request(app.getHttpServer()).post("/dev/migrations/apply-one").send({});
      expect(res.status).toBe(400);
    });

    it("POST /dev/migrations/dry-run rejects a malformed name", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/migrations/dry-run")
        .send({ name: "no-timestamp-prefix" });
      expect(res.status).toBe(400);
    });

    it("POST /dev/migrations/create rejects names with capitals or special chars", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/migrations/create")
        .send({ name: "AddTable!" });
      expect(res.status).toBe(400);
    });

    it("DELETE /dev/migrations/draft/:name rejects path-traversal", async () => {
      const res = await request(app.getHttpServer()).delete(
        "/dev/migrations/draft/..%2F..%2Fetc%2Fpasswd",
      );
      expect(res.status).toBe(400);
    });

    it("GET /dev/migrations/diff returns a structured response", async () => {
      const res = await request(app.getHttpServer()).get("/dev/migrations/diff");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(typeof res.body.success).toBe("boolean");
      expect(typeof res.body.sql).toBe("string");
      expect(typeof res.body.stderr).toBe("string");
    });
  });

  describe("outside development mode", () => {
    let app: INestApplication;

    beforeAll(async () => {
      process.env.NODE_ENV = "production";
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      process.env.NODE_ENV = "test";
    });

    it("GET /dev/migrations returns 404 in production", async () => {
      const res = await request(app.getHttpServer()).get("/dev/migrations");
      expect(res.status).toBe(404);
    });

    it("GET /dev/migrations.json returns 404 in production", async () => {
      const res = await request(app.getHttpServer()).get("/dev/migrations.json");
      expect(res.status).toBe(404);
    });

    it("POST /dev/migrations/deploy returns 404 in production", async () => {
      const res = await request(app.getHttpServer()).post("/dev/migrations/deploy");
      expect(res.status).toBe(404);
    });

    it("POST /dev/migrations/apply-one returns 404 in production", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/migrations/apply-one")
        .send({ name: "20260428000050_init_schema" });
      expect(res.status).toBe(404);
    });

    it("POST /dev/migrations/create returns 404 in production", async () => {
      const res = await request(app.getHttpServer())
        .post("/dev/migrations/create")
        .send({ name: "test-feature" });
      expect(res.status).toBe(404);
    });

    it("DELETE /dev/migrations/draft/:name returns 404 in production", async () => {
      const res = await request(app.getHttpServer()).delete(
        "/dev/migrations/draft/20260428000050_init_schema",
      );
      expect(res.status).toBe(404);
    });
  });
});
