import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../src/core/app/bootstrap.js";
import { HealthService } from "../src/core/health/health.service.js";
import type { EmailOutboxStorage } from "../src/core/email/email-outbox.js";

/**
 * Adapted from nest-server health-check tests.
 *
 * Two distinct endpoints per the standard k8s-style probe split:
 *   - /health/live  → process is alive; never queries dependencies.
 *                     Used by liveness probes — returning 200 always
 *                     unless the event loop is stuck or boot failed.
 *   - /health/ready → service can serve traffic; pings DB + critical
 *                     dependencies. Returning non-200 lets the LB drain
 *                     while the dependency is recovering.
 *
 * The full e2e suite shares one Postgres testcontainer across all
 * worker processes. Other test files insert rows into `email_outbox`;
 * once their age exceeds the 30s threshold the readiness endpoint
 * flips to 503 and this file's assertions flake. The fix is to swap
 * the bound HealthService's email-outbox storage for an in-memory
 * fake that always reports a clean queue. The email-outbox health
 * classifier itself is exercised end-to-end in
 * `tests/stories/email-outbox-health.story.test.ts`. (iter-147)
 */
describe("Health endpoints", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootstrap({ listen: false });
    const health = app.get(HealthService);
    const cleanQueue: Pick<EmailOutboxStorage, "countPending" | "oldestPendingAge"> = {
      async countPending() {
        return 0;
      },
      async oldestPendingAge() {
        return 0;
      },
    };
    // The HealthService keeps the storage as a private optional field.
    // Reflecting in here is intentional: we don't want to mutate the
    // real DB rows (would race with email-outbox-flow tests in other
    // workers), and bootstrap() doesn't expose a way to override the
    // EMAIL_OUTBOX_STORAGE provider. Centralised in this file because
    // no production code path takes this seam.
    Reflect.set(health, "emailOutbox", cleanQueue);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("GET /health/live", () => {
    it("responds 200 with status=ok", async () => {
      const response = await request(app.getHttpServer()).get("/health/live").expect(200);
      expect(response.body).toMatchObject({ status: "ok" });
    });

    it("returns JSON content-type", async () => {
      const response = await request(app.getHttpServer()).get("/health/live");
      expect(response.headers["content-type"]).toMatch(/application\/json/);
    });

    it("does not include dependency check results (liveness ≠ readiness)", async () => {
      const response = await request(app.getHttpServer()).get("/health/live");
      expect(response.body.checks).toBeUndefined();
    });
  });

  describe("GET /health/ready", () => {
    it("responds 200 with status=ok and the database check passing", async () => {
      const response = await request(app.getHttpServer()).get("/health/ready").expect(200);
      expect(response.body).toMatchObject({
        status: "ok",
        checks: { database: { status: "ok" } },
      });
    });

    it("returns the database response time as a number", async () => {
      const response = await request(app.getHttpServer()).get("/health/ready");
      expect(response.body.checks.database.responseTimeMs).toBeTypeOf("number");
      expect(response.body.checks.database.responseTimeMs).toBeGreaterThanOrEqual(0);
    });
  });
});
