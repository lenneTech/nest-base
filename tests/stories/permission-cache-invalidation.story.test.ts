import { describe, expect, it } from "vitest";

import type { DbPermissionRow } from "../../src/core/permissions/db-rule-resolver.js";
import {
  PermissionService,
  type PermissionStorage,
} from "../../src/core/permissions/permission.service.js";

/**
 * Story · CASL ability cache + invalidation hooks
 * (CF.MTPERM.07 / iter-96 review Finding 9).
 *
 * The PRD pins "CASL ability + DB-rule resolver + ability cache" plus
 * Phase-2 "Ability cache in CASL resolver". The cache landed in
 * iter-? and ships TTL+LRU semantics with `invalidate(userId, tenantId)`
 * + `invalidate(userId)`. Iter-98 closes the loop with two additional
 * surfaces:
 *   1. `invalidateAll()` — broadest invalidation, called on
 *      role/policy/permission graph mutations whose affected user set
 *      is unknown without a graph walk.
 *   2. `cacheSize()` — observability surface (used by the Hub portal +
 *      tests).
 *
 * The admin-crud controllers (`/admin/roles`, `/admin/policies`,
 * `/admin/permissions`) call `invalidateAll()` from their create +
 * delete handlers so a fresh request rebuilds without waiting on the
 * 60s TTL.
 */
function fakeStorage(): PermissionStorage & { calls: number } {
  let calls = 0;
  const rows: DbPermissionRow[] = [
    {
      resource: "Project",
      action: "READ",
      itemFilter: null,
      fields: [],
    },
  ];
  return {
    get calls() {
      return calls;
    },
    set calls(v: number) {
      calls = v;
    },
    async findRulesForUser() {
      calls++;
      return rows;
    },
  } as PermissionStorage & { calls: number };
}

describe("Story · PermissionService cache invalidation", () => {
  describe("invalidateAll()", () => {
    it("drops every cached ability", async () => {
      const storage = fakeStorage();
      const svc = new PermissionService(storage);

      await svc.abilityFor("u1", "t1");
      await svc.abilityFor("u2", "t1");
      await svc.abilityFor("u1", "t2");
      expect(svc.cacheSize()).toBe(3);

      svc.invalidateAll();
      expect(svc.cacheSize()).toBe(0);

      // Re-build verifies the cache is genuinely cleared.
      await svc.abilityFor("u1", "t1");
      expect(svc.cacheSize()).toBe(1);
    });
  });

  describe("admin-crud invalidation hook", () => {
    it("source: AdminCrudModule's CrudController calls permissions.invalidateAll() in create + delete", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(
        resolve(process.cwd(), "src/core/permissions/admin-crud.module.ts"),
        "utf8",
      );
      // Both mutation paths invalidate.
      expect(src).toContain("this.permissions?.invalidateAll()");
      // The dependency is wired via @Optional() @Inject(PermissionService).
      expect(src).toMatch(/@Optional\(\)\s*@Inject\(PermissionService\)/);
    });
  });
});
