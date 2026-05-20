import type { INestApplication } from "@nestjs/common";
import type { Agent } from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POWER_SYNC_STORE, type PowerSyncStore } from "../src/core/auth/powersync-store.js";
import { SINGLE_TENANT_ID } from "../src/core/auth/powersync-tenant.js";
import { createApiTestSession, withApiTestAbility } from "./helpers/api-request.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * E2E · PowerSync /powersync/crud in SINGLE-TENANT mode.
 *
 * With `FEATURE_MULTI_TENANCY_ENABLED=false` the TenantInterceptor is
 * not registered, so `getCurrentTenantId()` is undefined. Before this
 * change the controller rejected every upload with "no active tenant".
 * Now it buckets the batch under the `SINGLE_TENANT_ID` sentinel and
 * succeeds — and the persisted row carries the sentinel tenant id.
 */
describe("PowerSyncController · single-tenant mode", () => {
  let app: INestApplication;
  let agent: Agent;
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const previousPowerSyncFlag = process.env.FEATURE_POWERSYNC_ENABLED;
  const previousMultiTenancyFlag = process.env.FEATURE_MULTI_TENANCY_ENABLED;

  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
    // The valid-today-rejected combo: powerSync on, multiTenancy off.
    process.env.FEATURE_POWERSYNC_ENABLED = "true";
    process.env.FEATURE_MULTI_TENANCY_ENABLED = "false";
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    // bootstrap() runs validateFeatureDependencies — it must NOT throw
    // for this combo anymore.
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    const session = await createApiTestSession(app.getHttpServer());
    agent = session.agent;
  });

  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
    if (previousPowerSyncFlag === undefined) delete process.env.FEATURE_POWERSYNC_ENABLED;
    else process.env.FEATURE_POWERSYNC_ENABLED = previousPowerSyncFlag;
    if (previousMultiTenancyFlag === undefined) delete process.env.FEATURE_MULTI_TENANCY_ENABLED;
    else process.env.FEATURE_MULTI_TENANCY_ENABLED = previousMultiTenancyFlag;
  });

  it("accepts an upload batch (204) without an active tenant — no longer rejected", async () => {
    const res = await withApiTestAbility(agent.post("/api/powersync/crud")).send({
      batch: [{ op: "PUT", type: "widgets", id: "st-1", data: { name: "single" } }],
    });
    expect(res.status).toBe(204);
  });

  it("persists the row under the SINGLE_TENANT_ID sentinel", async () => {
    await withApiTestAbility(agent.post("/api/powersync/crud")).send({
      batch: [{ op: "PUT", type: "gadgets", id: "st-2", data: { name: "sentinel" } }],
    });
    const store = app.get<PowerSyncStore>(POWER_SYNC_STORE);
    const rows = await store.loadByTypes(SINGLE_TENANT_ID, ["gadgets"]);
    expect(rows.map((r) => ({ id: r.id, name: r.data.name }))).toContainEqual({
      id: "st-2",
      name: "sentinel",
    });
  });
});
