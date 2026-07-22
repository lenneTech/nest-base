import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootstrap } from "../../src/core/app/bootstrap.js";
import { hubReqScoped, pinHubTestAuthEnv } from "../helpers/hub-request.js";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * Story · `/admin/*` → `/hub/admin/*` consolidation (api-stability-promise).
 *
 * The Hub consolidation moves every admin portal surface under the one
 * `/hub` namespace. The old `/admin/*` paths stay routable but answer
 * `308 Permanent Redirect` to their `/hub/admin/*` successor — 308 (not
 * 301) so non-GET methods and request bodies survive the hop.
 *
 * Contract locked here:
 *   1. every legacy `/admin/<x>` path → 308 with the exact
 *      `Location: /hub/admin/<x>` equivalent (query string preserved)
 *   2. the redirect is METHODFUL — POST/PATCH/DELETE get the same 308
 *      (a 301/302 would downgrade them to GET)
 *   3. the redirect sits BEHIND the session/ability wall: anonymous
 *      requests see exactly yesterday's wall (302 → `/` for browsers,
 *      401 for JSON), never a 308 — no new anonymous surface
 *   4. the new `/hub/admin/*` paths serve the same payloads the old
 *      paths served (spot-checked here; the migrated per-controller
 *      stories pin the full behaviour)
 */
describe("Story · legacy /admin/* answers 308 to /hub/admin/*", () => {
  let app: INestApplication;
  let httpServer: Parameters<typeof request>[0];
  let hub: Awaited<ReturnType<typeof hubReqScoped>>;

  beforeAll(async () => {
    pinHubTestAuthEnv();
    process.env.FEATURE_RATE_LIMIT_ENABLED ??= "true";
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
    httpServer = app.getHttpServer();
    hub = await hubReqScoped(app);
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  describe("GET redirects (authorized session)", () => {
    const CASES: Array<{ old: string; target: string }> = [
      { old: "/admin", target: "/hub/admin" },
      { old: "/admin/users", target: "/hub/admin/users" },
      { old: "/admin/users/list.json", target: "/hub/admin/users/list.json" },
      { old: "/admin/tenants", target: "/hub/admin/tenants" },
      { old: "/admin/sessions/list.json", target: "/hub/admin/sessions/list.json" },
      { old: "/admin/roles", target: "/hub/admin/roles" },
      { old: "/admin/policies", target: "/hub/admin/policies" },
      { old: "/admin/permissions", target: "/hub/admin/permissions" },
      { old: "/admin/permissions/matrix.json", target: "/hub/admin/permissions/matrix.json" },
      { old: "/admin/permissions/test", target: "/hub/admin/permissions/test" },
      { old: "/admin/rate-limits", target: "/hub/admin/rate-limits" },
      { old: "/admin/webhooks.json", target: "/hub/admin/webhooks.json" },
      { old: "/admin/realtime.json", target: "/hub/admin/realtime.json" },
      { old: "/admin/audit", target: "/hub/admin/audit" },
      { old: "/admin/search", target: "/hub/admin/search" },
      { old: "/admin/jobs", target: "/hub/admin/jobs" },
      { old: "/admin/email-outbox/list.json", target: "/hub/admin/email-outbox/list.json" },
    ];

    for (const { old, target } of CASES) {
      it(`${old} → 308 ${target}`, async () => {
        const res = await hub.get(old);
        expect(res.status).toBe(308);
        expect(res.headers.location).toBe(target);
      });
    }

    it("preserves the query string on the Location header", async () => {
      const res = await hub.get("/admin/users/list.json?q=alice&filter=active");
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe("/hub/admin/users/list.json?q=alice&filter=active");
    });
  });

  describe("non-GET methods get the same 308 (method + body survive)", () => {
    it("POST /admin/roles → 308 /hub/admin/roles", async () => {
      const res = await hub.post("/admin/roles").send({ name: "redirect-probe" });
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe("/hub/admin/roles");
    });

    it("PATCH /admin/tenants/:id → 308", async () => {
      const res = await hub.patch("/admin/tenants/00000000-0000-0000-0000-000000000000");
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe("/hub/admin/tenants/00000000-0000-0000-0000-000000000000");
    });

    it("DELETE /admin/sessions/:id → 308", async () => {
      const res = await hub.delete("/admin/sessions/some-session-id");
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe("/hub/admin/sessions/some-session-id");
    });

    it("PUT /admin/rate-limits/config/:scope → 308", async () => {
      const res = await hub.put("/admin/rate-limits/config/global").send({});
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe("/hub/admin/rate-limits/config/global");
    });

    it("POST /admin/impersonation/stop → 308", async () => {
      const res = await hub.post("/admin/impersonation/stop");
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe("/hub/admin/impersonation/stop");
    });
  });

  describe("no new anonymous surface — session wall answers first", () => {
    it("anonymous browser navigation still 302s to the login page (not 308)", async () => {
      const res = await request(httpServer).get("/admin/users").set("accept", "text/html");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });

    it("anonymous JSON request still 401s (not 308)", async () => {
      const res = await request(httpServer)
        .get("/admin/users/list.json")
        .set("accept", "application/json");
      expect(res.status).toBe(401);
    });

    it("anonymous POST still hits the wall (not 308)", async () => {
      const res = await request(httpServer).post("/admin/roles").send({ name: "x" });
      expect(res.status).toBe(401);
    });
  });

  describe("new /hub/admin/* paths serve what the old paths served", () => {
    it("GET /hub/admin/users/list.json responds 200 with a users list", async () => {
      const res = await hub.get("/hub/admin/users/list.json");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.users)).toBe(true);
    });

    it("GET /hub/admin/roles responds 200 with an array", async () => {
      const res = await hub.get("/hub/admin/roles");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it("GET /hub/admin/users renders the SPA shell", async () => {
      const res = await hub.get("/hub/admin/users").set("accept", "text/html");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.text).toContain('<div id="root">');
    });

    it("GET /hub/admin/permissions/matrix.json responds 200", async () => {
      const res = await hub.get("/hub/admin/permissions/matrix.json");
      expect(res.status).toBe(200);
    });

    it("anonymous JSON on the new path still 401s (wall unchanged)", async () => {
      const res = await request(httpServer)
        .get("/hub/admin/users/list.json")
        .set("accept", "application/json");
      expect(res.status).toBe(401);
    });

    it("anonymous browser navigation on the new path 302s to the login page", async () => {
      const res = await request(httpServer).get("/hub/admin/users").set("accept", "text/html");
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("/");
    });
  });
});
