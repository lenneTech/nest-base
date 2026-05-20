import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SCHEDULED_JOB_REGISTRY,
  type ScheduledJobRegistry,
} from "../../src/core/jobs/scheduled-job.registry.js";
import { hubReqScoped, pinHubTestAuthEnv } from "../helpers/hub-request.js";

const TENANT = "11111111-1111-1111-1111-111111111111";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · @ScheduledJob runtime DiscoveryService walk
 * (CF.JOBS.02 — Finding 3 from iter-84 reviewer).
 *
 * Iter-31 added the `@ScheduledJob` metadata decorator. Iter-74/75/77/...
 * stamped real cron handlers (apiKeyExpiry / gdprErasure / ...) but
 * no runtime ever read the metadata to schedule them — the decorator
 * was decorative metadata. Iter-95 closes the loop with a
 * `ScheduledJobRegistry` that walks every provider via
 * `DiscoveryService` at `OnApplicationBootstrap`, reads the
 * `@ScheduledJob` metadata via `getScheduledJobs(prototype)`, and
 * registers each entry into a runtime registry so:
 *  - The Hub can list active jobs at `/hub/scheduled-jobs.json`.
 *  - Tests can drive any scheduled tick via `registry.runOnce(name)`.
 *  - Future PgBossAdapter consumes the same registry to call
 *    `pgboss.schedule(name, cron, handler)` per entry.
 */
describe("Story · ScheduledJob DiscoveryService walk", () => {
  let app: INestApplication;
  let registry: ScheduledJobRegistry;

  beforeAll(async () => {
    pinHubTestAuthEnv();
    const { bootstrap } = await import("../../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    registry = app.get<ScheduledJobRegistry>(SCHEDULED_JOB_REGISTRY);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("registers every @ScheduledJob method that exists in the app", () => {
    const entries = registry.list();
    const names = entries.map((e) => e.name).sort();
    // Iter-74 + iter-75 stamped these:
    expect(names).toContain("apiKeyExpiry");
    expect(names).toContain("gdprErasure");
  });

  it("each entry carries name + cron + handler", () => {
    const entry = registry.list().find((e) => e.name === "apiKeyExpiry");
    expect(entry).toBeDefined();
    expect(entry?.cron).toBe("0 8 * * *");
    expect(typeof entry?.run).toBe("function");
  });

  it("runOnce(name) invokes the bound method (returns its result)", async () => {
    const result = await registry.runOnce("apiKeyExpiry");
    // ApiKeyExpiryRunner.tick returns { notified: number }
    expect(result).toMatchObject({ notified: expect.any(Number) });
  });

  it("runOnce(name) throws for unknown jobs", async () => {
    await expect(registry.runOnce("does-not-exist")).rejects.toThrow(/scheduled job/i);
  });

  it("GET /hub/scheduled-jobs.json surfaces the registry", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    pinHubTestAuthEnv();
    try {
      const hub = await hubReqScoped(app, TENANT);
      const res = await hub.get("/hub/scheduled-jobs.json");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.jobs)).toBe(true);
      const names = (res.body.jobs as Array<{ name: string }>).map((j) => j.name).sort();
      expect(names).toContain("apiKeyExpiry");
      expect(names).toContain("gdprErasure");
      const apiKeyJob = (res.body.jobs as Array<{ name: string; cron: string }>).find(
        (j) => j.name === "apiKeyExpiry",
      );
      expect(apiKeyJob?.cron).toBe("0 8 * * *");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
    }
  });
});
