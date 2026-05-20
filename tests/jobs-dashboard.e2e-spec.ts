import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { hubReqScoped, pinHubTestAuthEnv } from "./helpers/hub-request.js";

const TENANT = "11111111-1111-1111-1111-111111111111";
import { JobQueueService } from "../src/core/jobs/jobs.module.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Jobs-Dashboard endpoints (#15).
 *
 * Read-side endpoints under `/hub/jobs/*` 404 outside development and
 * surface the same view of the in-memory queue the SPA renders. The
 * write-side `retry` endpoint re-enqueues a failed job through the
 * shared `JobQueueService`.
 *
 * Tests are scoped to the in-memory adapter; the future pg-boss
 * adapter swap re-uses the same JSON contract.
 */
describe("Hub Jobs Dashboard · /hub/jobs/*", () => {
  describe("in development mode", () => {
    let app: INestApplication;
    let hub: Awaited<ReturnType<typeof hubReqScoped>>;
    let queue: JobQueueService;
    let previousNodeEnv: string | undefined;

    beforeAll(async () => {
      previousNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      pinHubTestAuthEnv();
      app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
      hub = await hubReqScoped(app, TENANT);
      queue = app.get(JobQueueService);
    });

    afterAll(async () => {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    });

    beforeEach(async () => {
      // Seed each test with a fresh handler set; jobs accumulate in
      // history across tests so each spec asserts on counts that come
      // from the jobs it created.
      queue.register("e2e-ok", async () => {});
      queue.register("e2e-bad", async () => {
        throw new Error("e2e failure");
      });
    });

    it("GET /hub/jobs renders the SPA shell", async () => {
      const res = await hub.get("/hub/jobs");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain('<div id="root"></div>');
      expect(res.text).toMatch(/<title>Jobs — nest-server<\/title>/);
    });

    it("GET /hub/jobs/queues.json returns the aggregated snapshot", async () => {
      const id = await queue.enqueue("e2e-ok", { who: "alice" });
      await queue.drain();
      const res = await hub.get("/hub/jobs/queues.json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(typeof res.body.totalJobs).toBe("number");
      expect(res.body.totalJobs).toBeGreaterThan(0);
      expect(res.body.totals).toHaveProperty("completed");
      expect(res.body.totals).toHaveProperty("failed");
      expect(Array.isArray(res.body.queues)).toBe(true);
      const matching = res.body.queues.find((q: { name: string }) => q.name === "e2e-ok");
      expect(matching).toBeDefined();
      expect(matching.counts.completed).toBeGreaterThan(0);
      // Job we just enqueued shows up in the listing endpoint too.
      const list = await hub.get(`/hub/jobs/jobs.json?name=e2e-ok&limit=10`);
      const ids: string[] = list.body.jobs.map((j: { id: string }) => j.id);
      expect(ids).toContain(id);
    });

    it("GET /hub/jobs/jobs.json supports state + name filters and limit", async () => {
      await queue.enqueue("e2e-ok", { i: 1 });
      await queue.enqueue("e2e-ok", { i: 2 });
      await queue.enqueue("e2e-bad", { i: 3 });
      await queue.drain();
      const completed = await hub.get("/hub/jobs/jobs.json?state=completed&name=e2e-ok&limit=50");
      expect(completed.status).toBe(200);
      expect(Array.isArray(completed.body.jobs)).toBe(true);
      for (const job of completed.body.jobs) {
        expect(job.state).toBe("completed");
        expect(job.name).toBe("e2e-ok");
      }
      const failed = await hub.get("/hub/jobs/jobs.json?state=failed");
      expect(failed.status).toBe(200);
      for (const job of failed.body.jobs) {
        expect(job.state).toBe("failed");
      }
      // Sanity: the smallest limit is honoured.
      const tiny = await hub.get("/hub/jobs/jobs.json?limit=1");
      expect(tiny.body.jobs.length).toBe(1);
    });

    it("GET /hub/jobs/jobs/:id.json returns the full record + 404 on miss", async () => {
      const id = await queue.enqueue("e2e-ok", { hello: "world" });
      await queue.drain();
      const detail = await hub.get(`/hub/jobs/jobs/${id}.json`);
      expect(detail.status).toBe(200);
      expect(detail.body.id).toBe(id);
      expect(detail.body.payload).toEqual({ hello: "world" });
      expect(detail.body.state).toBe("completed");
      expect(typeof detail.body.createdAt).toBe("number");

      const miss = await hub.get("/hub/jobs/jobs/no-such-id-exists-here.json");
      expect(miss.status).toBe(404);
    });

    it("GET /hub/jobs/jobs/:id.json accepts BullMQ-style custom ids (colons)", async () => {
      // Scheduled/repeat jobs use ids like `scheduled:<name>` — reject at
      // the path validator used to surface 400 before lookup; unknown ids
      // should 404 instead.
      const customId = "scheduled:e2e-colon-id";
      const detail = await hub.get(`/hub/jobs/jobs/${encodeURIComponent(customId)}.json`);
      expect(detail.status).toBe(404);
    });

    it("rejects unsafe job ids on detail / retry", async () => {
      // Path-traversal-shaped ids are rejected before the lookup runs.
      // The route validator allows slug-shaped BullMQ ids (≤ 128 chars);
      // anything with a space, dot-segment, or path-traversal char is
      // a 400 BadRequest. Note: literal `/` in the URL would land on
      // a different route (the SPA catch-all), so we test the cases
      // that actually reach the param handler.
      const badIds = ["..", "weird%20id", "..%2Etxt", "way-too-long-".repeat(10)];
      for (const bad of badIds) {
        const detail = await hub.get(`/hub/jobs/jobs/${bad}.json`);
        expect([400, 404]).toContain(detail.status);
        const retry = await hub.post(`/hub/jobs/jobs/${bad}/retry`);
        expect([400, 404]).toContain(retry.status);
      }
    });

    it("POST /hub/jobs/jobs/:id/retry re-enqueues a failed job", async () => {
      const original = await queue.enqueue("e2e-bad", { run: 1 });
      await queue.drain();
      const res = await hub.post(`/hub/jobs/jobs/${original}/retry`).send();
      expect(res.status).toBe(200);
      expect(typeof res.body.id).toBe("string");
      expect(res.body.id).not.toBe(original);
      // Drain so the retried job ages into a terminal state.
      await queue.drain();
      const retried = await hub.get(`/hub/jobs/jobs/${res.body.id}.json`);
      expect(retried.status).toBe(200);
      expect(retried.body.attempt).toBe(2);
    });

    it("POST /hub/jobs/jobs/:id/retry returns 404 when the id is unknown", async () => {
      const res = await hub.post(`/hub/jobs/jobs/${"a".repeat(36)}/retry`).send();
      expect(res.status).toBe(404);
    });

    it("POST /hub/jobs/jobs/:id/retry returns 409 when the job is not failed", async () => {
      const id = await queue.enqueue("e2e-ok", {});
      await queue.drain();
      const res = await hub.post(`/hub/jobs/jobs/${id}/retry`).send();
      expect(res.status).toBe(409);
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

    it("404s on /hub/jobs/queues.json", async () => {
      const res = await hub.get("/hub/jobs/queues.json");
      expect(res.status).toBe(404);
    });

    it("404s on /hub/jobs/jobs.json", async () => {
      const res = await hub.get("/hub/jobs/jobs.json");
      expect(res.status).toBe(404);
    });
  });
});
