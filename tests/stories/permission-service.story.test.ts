import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PermissionService,
  type PermissionStorage,
} from "../../src/core/permissions/permission.service.js";
import type { DbPermissionRow } from "../../src/core/permissions/db-rule-resolver.js";

/**
 * Story · PermissionService.abilityFor() + Cache (PLAN.md §6 + §32 Phase 3).
 *
 * The service fetches the user's resolved Permission rows from storage,
 * runs them through the DB-Rule resolver, and caches the resulting
 * Ability under (userId, tenantId) for 60s. Mutating an admin's policies
 * goes through `invalidate()` so the next request rebuilds.
 */
describe("Story · PermissionService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-28T18:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeStorage(rows: DbPermissionRow[] = []): PermissionStorage & { calls: number } {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      async findRulesForUser(_userId, _tenantId) {
        calls += 1;
        return rows;
      },
    };
  }

  it("abilityFor() returns an ability that reflects the storage rows", async () => {
    const storage = makeStorage([
      { resource: "Project", action: "READ", itemFilter: null, fields: [] },
    ]);
    const svc = new PermissionService(storage);
    const ability = await svc.abilityFor("u1", "t1");
    expect(ability.can("read", "Project")).toBe(true);
    expect(ability.can("delete", "Project")).toBe(false);
  });

  it("caches on (userId, tenantId) — second call within TTL hits cache", async () => {
    const storage = makeStorage([
      { resource: "Project", action: "READ", itemFilter: null, fields: [] },
    ]);
    const svc = new PermissionService(storage);
    await svc.abilityFor("u1", "t1");
    await svc.abilityFor("u1", "t1");
    expect(storage.calls).toBe(1);
  });

  it("different (userId, tenantId) keys do not collide", async () => {
    const storage = makeStorage([]);
    const svc = new PermissionService(storage);
    await svc.abilityFor("u1", "t1");
    await svc.abilityFor("u2", "t1");
    await svc.abilityFor("u1", "t2");
    expect(storage.calls).toBe(3);
  });

  it("refetches after the 60s TTL elapses", async () => {
    const storage = makeStorage([]);
    const svc = new PermissionService(storage);
    await svc.abilityFor("u1", "t1");
    vi.advanceTimersByTime(60_000 + 1);
    await svc.abilityFor("u1", "t1");
    expect(storage.calls).toBe(2);
  });

  it("still hits cache one second before TTL expiry", async () => {
    const storage = makeStorage([]);
    const svc = new PermissionService(storage);
    await svc.abilityFor("u1", "t1");
    vi.advanceTimersByTime(59_000);
    await svc.abilityFor("u1", "t1");
    expect(storage.calls).toBe(1);
  });

  describe("invalidate()", () => {
    it("invalidate(userId, tenantId) drops only that entry", async () => {
      const storage = makeStorage([]);
      const svc = new PermissionService(storage);
      await svc.abilityFor("u1", "t1");
      await svc.abilityFor("u1", "t2");
      svc.invalidate("u1", "t1");
      await svc.abilityFor("u1", "t1");
      await svc.abilityFor("u1", "t2");
      expect(storage.calls).toBe(3); // initial 2 + one refetch
    });

    it("invalidate(userId) drops all entries for the user", async () => {
      const storage = makeStorage([]);
      const svc = new PermissionService(storage);
      await svc.abilityFor("u1", "t1");
      await svc.abilityFor("u1", "t2");
      await svc.abilityFor("u2", "t1");
      svc.invalidate("u1");
      await svc.abilityFor("u1", "t1");
      await svc.abilityFor("u1", "t2");
      await svc.abilityFor("u2", "t1");
      expect(storage.calls).toBe(5); // 3 initial + 2 refetches for u1
    });
  });

  describe("LRU eviction", () => {
    it("evicts the least-recently-used entry when over capacity", async () => {
      const storage = makeStorage([]);
      const svc = new PermissionService(storage, { maxEntries: 2 });
      await svc.abilityFor("u1", "t1");
      await svc.abilityFor("u2", "t1");
      // u1 is now LRU; touching u2 keeps it warm
      await svc.abilityFor("u2", "t1");
      // adding u3 evicts u1
      await svc.abilityFor("u3", "t1");
      // u1 must refetch (was evicted)
      await svc.abilityFor("u1", "t1");
      expect(storage.calls).toBe(4);
    });
  });
});
