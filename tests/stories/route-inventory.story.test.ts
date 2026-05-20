import { describe, expect, it } from "vitest";

import { buildRouteInventory, type RouteRecord } from "../../src/core/dx/route-inventory.js";

/**
 * Story · `/hub/routes` — Route Inventory.
 *
 * Pure planner that takes the Express-style route stack (or
 * NestJS' equivalent) and returns a structured list. Used by:
 *   - GET /hub/routes      → HTML table with decorator badges
 *   - GET /hub/routes.json → raw JSON for SDK / agent tooling
 *
 * Why this matters: a downstream agent or human auditor needs to
 * answer "which endpoints have no permission decorator?" and
 * "where is POST /users defined?" in seconds. Today that requires
 * grepping every controller.
 */
describe("Story · buildRouteInventory", () => {
  it("returns one entry per (method, path) pair", () => {
    const stack = [
      { method: "GET", path: "/health/live", controller: "HealthController", handler: "live" },
      { method: "GET", path: "/health/ready", controller: "HealthController", handler: "ready" },
      { method: "POST", path: "/projects", controller: "ProjectController", handler: "create" },
    ];
    const inventory = buildRouteInventory({ routes: stack });
    expect(inventory.routes).toHaveLength(3);
  });

  it("sorts by path, then by method", () => {
    const stack = [
      { method: "POST", path: "/users", controller: "U", handler: "c" },
      { method: "GET", path: "/projects", controller: "P", handler: "l" },
      { method: "GET", path: "/users", controller: "U", handler: "l" },
    ];
    const inventory = buildRouteInventory({ routes: stack });
    expect(inventory.routes.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /projects",
      "GET /users",
      "POST /users",
    ]);
  });

  it("propagates the @Can() decorator metadata when present", () => {
    const stack = [
      {
        method: "GET",
        path: "/projects",
        controller: "P",
        handler: "list",
        canMetadata: { action: "read", subject: "Project" },
      },
    ];
    const inventory = buildRouteInventory({ routes: stack });
    expect(inventory.routes[0]?.guards).toEqual([
      { kind: "can", action: "read", subject: "Project" },
    ]);
  });

  it("flags routes with NO permission gate (no Can metadata) as 'unguarded'", () => {
    const stack = [
      { method: "GET", path: "/projects", controller: "P", handler: "list" },
      {
        method: "POST",
        path: "/projects",
        controller: "P",
        handler: "create",
        canMetadata: { action: "create", subject: "Project" },
      },
    ];
    const inventory = buildRouteInventory({ routes: stack });
    expect(inventory.routes[0]?.guards).toEqual([{ kind: "unguarded" }]);
    expect(inventory.routes[1]?.guards).toEqual([
      { kind: "can", action: "create", subject: "Project" },
    ]);
  });

  it("respects an explicit allow-list of routes that intentionally have no guard (health, openapi)", () => {
    const stack = [
      { method: "GET", path: "/health/live", controller: "H", handler: "live" },
      { method: "GET", path: "/api/openapi.json", controller: "O", handler: "doc" },
    ];
    const inventory = buildRouteInventory({
      routes: stack,
      publicAllowlist: ["/health/", "/api/openapi"],
    });
    expect(inventory.routes[0]?.guards).toEqual([{ kind: "public" }]);
    expect(inventory.routes[1]?.guards).toEqual([{ kind: "public" }]);
  });

  it("counts the unguarded routes in the summary so an audit can spot drift", () => {
    const stack = [
      { method: "GET", path: "/health/live", controller: "H", handler: "live" }, // public
      {
        method: "GET",
        path: "/projects",
        controller: "P",
        handler: "list",
        canMetadata: { action: "read", subject: "Project" },
      },
      { method: "POST", path: "/secret", controller: "S", handler: "post" }, // UNGUARDED!
    ];
    const inventory = buildRouteInventory({
      routes: stack,
      publicAllowlist: ["/health/"],
    });
    expect(inventory.summary).toEqual({
      total: 3,
      guarded: 1,
      public: 1,
      devOnly: 0,
      unguarded: 1,
    });
  });

  it("groups routes by controller for the secondary view", () => {
    const stack = [
      { method: "GET", path: "/projects", controller: "ProjectController", handler: "l" },
      { method: "GET", path: "/users", controller: "UserController", handler: "l" },
      { method: "POST", path: "/users", controller: "UserController", handler: "c" },
    ];
    const inventory = buildRouteInventory({ routes: stack });
    const grouped = inventory.byController;
    expect(grouped["ProjectController"]).toHaveLength(1);
    expect(grouped["UserController"]).toHaveLength(2);
  });

  it("returns empty inventory when given no routes (regression safety)", () => {
    const inventory = buildRouteInventory({ routes: [] });
    expect(inventory.routes).toEqual([]);
    expect(inventory.summary).toEqual({
      total: 0,
      guarded: 0,
      public: 0,
      devOnly: 0,
      unguarded: 0,
    });
  });

  it("is total: every input route appears in the output", () => {
    const stack: Array<{ method: string; path: string; controller: string; handler: string }> = [];
    for (let i = 0; i < 50; i++) {
      stack.push({
        method: i % 2 === 0 ? "GET" : "POST",
        path: `/r/${i}`,
        controller: `C${i % 5}`,
        handler: `h${i}`,
      });
    }
    const inventory = buildRouteInventory({ routes: stack });
    expect(inventory.routes).toHaveLength(50);
    expect(inventory.summary.total).toBe(50);
    // Every input has exactly one output entry
    const seen = new Set<string>();
    for (const r of inventory.routes) seen.add(`${r.method} ${r.path}`);
    expect(seen.size).toBe(50);
  });

  it("normalises method to uppercase", () => {
    const inventory = buildRouteInventory({
      routes: [{ method: "get", path: "/x", controller: "C", handler: "h" }],
    });
    const r = inventory.routes[0] as RouteRecord;
    expect(r.method).toBe("GET");
  });

  describe("Dev-only allowlist (split from `public`)", () => {
    // Why: routes under /hub and /admin previously got the same
    // `public` label as /health and /api/openapi, which is misleading
    // — they're not actually public, they 404 in production via
    // `assertDev()`. Splitting the kinds gives a more honest audit:
    // an auditor sees how many routes are *truly* public vs only
    // exposed in development.
    it("classifies dev-only entries with kind=`dev-only` (not `public`)", () => {
      const stack = [
        { method: "GET", path: "/hub/diagnostics", controller: "D", handler: "d" },
        { method: "GET", path: "/admin/audit", controller: "A", handler: "a" },
        { method: "GET", path: "/health/live", controller: "H", handler: "h" },
      ];
      const inventory = buildRouteInventory({
        routes: stack,
        publicAllowlist: [
          { prefix: "/health/", kind: "public" },
          { prefix: "/hub", kind: "dev-only" },
          { prefix: "/admin", kind: "dev-only" },
        ],
      });
      const byPath: Record<string, RouteRecord> = {};
      for (const r of inventory.routes) byPath[r.path] = r;
      expect(byPath["/hub/diagnostics"]?.guards).toEqual([{ kind: "dev-only" }]);
      expect(byPath["/admin/audit"]?.guards).toEqual([{ kind: "dev-only" }]);
      expect(byPath["/health/live"]?.guards).toEqual([{ kind: "public" }]);
    });

    it("includes dev-only count in the summary alongside public/guarded/unguarded", () => {
      const stack = [
        { method: "GET", path: "/hub/x", controller: "D", handler: "h" },
        { method: "GET", path: "/admin/y", controller: "A", handler: "h" },
        { method: "GET", path: "/health/live", controller: "H", handler: "h" },
        {
          method: "GET",
          path: "/projects",
          controller: "P",
          handler: "list",
          canMetadata: { action: "read", subject: "Project" },
        },
        { method: "POST", path: "/secret", controller: "S", handler: "post" },
      ];
      const inventory = buildRouteInventory({
        routes: stack,
        publicAllowlist: [
          { prefix: "/hub", kind: "dev-only" },
          { prefix: "/admin", kind: "dev-only" },
          { prefix: "/health/", kind: "public" },
        ],
      });
      expect(inventory.summary).toEqual({
        total: 5,
        guarded: 1,
        public: 1,
        devOnly: 2,
        unguarded: 1,
      });
    });

    it("accepts the legacy string-array allowlist for backwards compatibility (treats all as public)", () => {
      const stack = [{ method: "GET", path: "/health/live", controller: "H", handler: "h" }];
      const inventory = buildRouteInventory({
        routes: stack,
        publicAllowlist: ["/health/"],
      });
      expect(inventory.routes[0]?.guards).toEqual([{ kind: "public" }]);
    });
  });
});
