import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RealtimeGateway } from "../src/core/realtime/realtime.module.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };
const TENANT = "11111111-1111-1111-1111-111111111111";

/**
 * `/admin/realtime*` — three JSON sidecars + three POST actions.
 *
 * The Realtime-Inspector upgrade extends the original `/admin/realtime`
 * surface with channel aggregation, per-socket disconnect/send, and an
 * event-replay endpoint. Everything 404s outside development so the
 * disconnect / send / replay actions can never leak in production.
 */
describe("Admin Realtime Inspector · /admin/realtime*", () => {
  describe("in development mode", () => {
    let app: INestApplication;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const { bootstrap } = await import("../src/core/app/bootstrap.js");
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /admin/realtime.json returns sockets + channels + events arrays", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/realtime.json")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.sockets)).toBe(true);
      expect(Array.isArray(res.body.channels)).toBe(true);
      expect(Array.isArray(res.body.events)).toBe(true);
      expect(typeof res.body.eventsPerSecond).toBe("number");
    });

    it("GET /admin/realtime/channels.json returns the aggregated channel list", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/realtime/channels.json")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(Array.isArray(res.body.channels)).toBe(true);
    });

    it("POST /admin/realtime/sockets/:id/disconnect 404s on an unknown socket", async () => {
      const res = await request(app.getHttpServer())
        .post("/admin/realtime/sockets/no-such-socket/disconnect")
        .set("x-tenant-id", TENANT)
        .send({});
      expect(res.status).toBe(404);
    });

    it("POST /admin/realtime/sockets/:id/disconnect tears the socket down on hit", async () => {
      const gateway = app.get(RealtimeGateway);
      // Inject a fake live socket directly into the inspector state so
      // the controller has something to find without spinning up a real
      // socket.io client.
      gateway.recordTestSocket({
        id: "fake-1",
        userId: "u1",
        tenantId: TENANT,
        userAgent: "vitest",
      });
      const res = await request(app.getHttpServer())
        .post("/admin/realtime/sockets/fake-1/disconnect")
        .set("x-tenant-id", TENANT)
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.id).toBe("fake-1");
      // The state has been cleaned up.
      const json = await request(app.getHttpServer())
        .get("/admin/realtime.json")
        .set("x-tenant-id", TENANT);
      const found = (json.body.sockets as Array<{ id: string }>).find((s) => s.id === "fake-1");
      expect(found).toBeUndefined();
    });

    it("POST /admin/realtime/sockets/:id/send rejects malformed bodies", async () => {
      const gateway = app.get(RealtimeGateway);
      gateway.recordTestSocket({ id: "fake-2", userId: "u1", tenantId: TENANT });
      const res = await request(app.getHttpServer())
        .post("/admin/realtime/sockets/fake-2/send")
        .set("x-tenant-id", TENANT)
        .send({});
      expect(res.status).toBe(400);
    });

    it("POST /admin/realtime/sockets/:id/send accepts a well-formed event", async () => {
      const gateway = app.get(RealtimeGateway);
      gateway.recordTestSocket({ id: "fake-3", userId: "u1", tenantId: TENANT });
      const res = await request(app.getHttpServer())
        .post("/admin/realtime/sockets/fake-3/send")
        .set("x-tenant-id", TENANT)
        .send({ eventType: "debug.ping", payload: { hello: "world" } });
      expect(res.status).toBe(200);
      expect(res.body.delivered).toBe(true);
    });

    it("POST /admin/realtime/events/replay rebroadcasts the supplied event", async () => {
      const res = await request(app.getHttpServer())
        .post("/admin/realtime/events/replay")
        .set("x-tenant-id", TENANT)
        .send({
          channel: "Project:tenant:t1",
          eventType: "project.updated",
          payload: { id: "p1" },
        });
      expect(res.status).toBe(200);
      expect(res.body.replayed).toBe(true);
    });

    it("POST /admin/realtime/events/replay rejects malformed bodies", async () => {
      const res = await request(app.getHttpServer())
        .post("/admin/realtime/events/replay")
        .set("x-tenant-id", TENANT)
        .send({ eventType: "x" });
      expect(res.status).toBe(400);
    });
  });

  describe("outside development mode", () => {
    let app: INestApplication;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      const { bootstrap } = await import("../src/core/app/bootstrap.js");
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    it("GET /admin/realtime/channels.json 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .get("/admin/realtime/channels.json")
        .set("x-tenant-id", TENANT);
      expect(res.status).toBe(404);
    });

    it("POST /admin/realtime/sockets/:id/disconnect 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .post("/admin/realtime/sockets/x/disconnect")
        .set("x-tenant-id", TENANT)
        .send({});
      expect(res.status).toBe(404);
    });

    it("POST /admin/realtime/events/replay 404s in production", async () => {
      const res = await request(app.getHttpServer())
        .post("/admin/realtime/events/replay")
        .set("x-tenant-id", TENANT)
        .send({});
      expect(res.status).toBe(404);
    });
  });
});
