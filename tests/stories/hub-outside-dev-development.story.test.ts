import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../../src/core/app/bootstrap.js";
import { hubReqScoped, pinHubTestAuthEnv } from "../helpers/hub-request.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · Hub outside development — development baseline is invariant.
 *
 * The `FEATURE_HUB_ENABLED` flag governs NON-development environments
 * only. In development the hub keeps today's behaviour under EVERY flag
 * value — here pinned with the strictest case, an explicit `false`:
 *   - operational surfaces stay available
 *   - workstation surfaces (file browser, migrations, ERD) stay available
 *   - the anonymous browser redirect to the login page stays intact
 *
 * This is the local-DX guarantee: flipping the production opt-in can
 * never lock a developer out of their own workstation tooling.
 */
describe("Story · Hub outside development (development boot, FEATURE_HUB_ENABLED=false)", () => {
  let app: INestApplication;
  let hub: Awaited<ReturnType<typeof hubReqScoped>>;
  let previousHubFlag: string | undefined;

  beforeAll(async () => {
    pinHubTestAuthEnv();
    previousHubFlag = process.env.FEATURE_HUB_ENABLED;
    // Explicit false — the strongest form of "the flag must not matter here".
    process.env.FEATURE_HUB_ENABLED = "false";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    hub = await hubReqScoped(app);
  }, 120_000);

  afterAll(async () => {
    await app.close();
    if (previousHubFlag === undefined) delete process.env.FEATURE_HUB_ENABLED;
    else process.env.FEATURE_HUB_ENABLED = previousHubFlag;
  });

  describe("operational surfaces stay available in development", () => {
    it("hub SPA shell renders", async () => {
      const res = await hub.get("/hub");
      expect(res.status).toBe(200);
    });

    it("the access probe reports workstation:true (flag value irrelevant in dev)", async () => {
      // Development invariance for the SPA nav: with the flag pinned to
      // FALSE the probe must still say workstation:true, so the sidebar
      // renders exactly as today on every developer workstation.
      const res = await hub.get("/hub/portal-access.json");
      expect(res.status).toBe(200);
      expect(res.body.workstation).toBe(true);
    });

    it("palette search keeps workstation pages in development", async () => {
      const res = await hub.get("/hub/palette/search.json?q=migrations");
      expect(res.status).toBe(200);
      const hrefs = (res.body.pages as Array<{ href: string }>).map((p) => p.href);
      expect(hrefs).toContain("/hub/migrations");
    });

    it("feature READ views respond 200", async () => {
      const res = await hub.get("/hub/features.json");
      expect(res.status).toBe(200);
    });

    it("admin CRUD responds 200", async () => {
      const res = await hub.get("/hub/admin/roles").set("accept", "application/json");
      expect(res.status).toBe(200);
    });

    it("legacy /admin paths 308 in development too (one redirect story everywhere)", async () => {
      const res = await hub.get("/admin/roles").set("accept", "application/json");
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe("/hub/admin/roles");
    });
  });

  describe("workstation surfaces stay available in development", () => {
    it("source-tree file browser responds 200", async () => {
      const res = await hub.get("/hub/files/tree.json");
      expect(res.status).toBe(200);
    });

    it("migrations runner responds 200", async () => {
      const res = await hub.get("/hub/migrations.json");
      expect(res.status).toBe(200);
    });

    it("ERD responds 200", async () => {
      const res = await hub.get("/hub/erd.json");
      expect(res.status).toBe(200);
    });
  });

  describe("development auth gate is unchanged", () => {
    it("anonymous browser navigation still redirects to the login page", async () => {
      const res = await request(app.getHttpServer()).get("/hub").set("accept", "text/html");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });
  });
});
