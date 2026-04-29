import { describe, expect, it } from "vitest";

import {
  PostgresThrottlerStore,
  ThrottlerService,
  type ThrottlerStorage,
  type ThrottleWindow,
} from "../../src/core/throttler/throttler.js";

/**
 * Story · @nestjs/throttler Postgres store + multi-window
 * (PLAN.md §32 Phase 8 + §28.6).
 *
 * Two pieces:
 *
 *   - PostgresThrottlerStore — `@nestjs/throttler`-compatible
 *     storage adapter that persists hit counts in Postgres so
 *     multiple app instances share one rate limit. We test against
 *     the in-memory implementation of the storage backend interface
 *     so the suite stays DB-free; the Postgres adapter is a thin
 *     SQL wrapper over the same shape.
 *
 *   - ThrottlerService — multi-window decision logic. The PLAN
 *     mandates 1s/1min/1h buckets; a request is denied as soon as
 *     ANY window is over its limit (defense-in-depth, like
 *     Cloudflare). The service stays I/O-free behind the storage
 *     abstraction.
 */
describe("Story · Throttler Postgres store + multi-window", () => {
  function memoryBackend(): { rows: Map<string, { count: number; expiresAt: number }> } & {
    upsert: (
      key: string,
      ttlMs: number,
      now: number,
    ) => Promise<{ count: number; expiresAt: number }>;
    reset: (key: string) => Promise<void>;
  } {
    const rows = new Map<string, { count: number; expiresAt: number }>();
    return {
      rows,
      async upsert(key, ttlMs, now) {
        const existing = rows.get(key);
        if (!existing || existing.expiresAt <= now) {
          const fresh = { count: 1, expiresAt: now + ttlMs };
          rows.set(key, fresh);
          return fresh;
        }
        existing.count += 1;
        return existing;
      },
      async reset(key) {
        rows.delete(key);
      },
    };
  }

  function makeStore(): { store: ThrottlerStorage; backend: ReturnType<typeof memoryBackend> } {
    const backend = memoryBackend();
    const store = new PostgresThrottlerStore(backend);
    return { store, backend };
  }

  describe("PostgresThrottlerStore", () => {
    it("records the first hit with totalHits=1", async () => {
      const { store } = makeStore();
      const result = await store.increment("k1", 60_000, 100, 0, "name");
      expect(result.totalHits).toBe(1);
      expect(result.timeToExpire).toBe(60);
    });

    it("increments existing hits within the window", async () => {
      const { store } = makeStore();
      await store.increment("k1", 60_000, 100, 0, "name");
      const result = await store.increment("k1", 60_000, 100, 100, "name");
      expect(result.totalHits).toBe(2);
    });

    it("resets the count after the window expires (timeToExpire dropped to 0)", async () => {
      const { store } = makeStore();
      await store.increment("k1", 60_000, 100, 0, "name");
      const result = await store.increment("k1", 60_000, 100, 60_001, "name");
      expect(result.totalHits).toBe(1);
    });

    it("reports isBlocked when count exceeds the limit", async () => {
      const { store } = makeStore();
      // Three calls; limit=2 → third must be blocked.
      await store.increment("k1", 60_000, 2, 0, "name");
      await store.increment("k1", 60_000, 2, 100, "name");
      const blocked = await store.increment("k1", 60_000, 2, 200, "name");
      expect(blocked.isBlocked).toBe(true);
    });

    it("keeps separate buckets per key", async () => {
      const { store } = makeStore();
      await store.increment("a", 60_000, 100, 0, "name");
      const b = await store.increment("b", 60_000, 100, 0, "name");
      expect(b.totalHits).toBe(1);
    });
  });

  describe("ThrottlerService.consume()", () => {
    function windows(): ThrottleWindow[] {
      return [
        { name: "1s", limit: 5, ttlMs: 1_000 },
        { name: "1m", limit: 60, ttlMs: 60_000 },
        { name: "1h", limit: 1000, ttlMs: 60 * 60_000 },
      ];
    }

    it("returns allowed=true when every window is under its limit", async () => {
      const { store } = makeStore();
      const svc = new ThrottlerService(store, { now: () => 0 });
      const result = await svc.consume({ key: "u-1:GET:/projects", windows: windows() });
      expect(result.allowed).toBe(true);
      expect(result.violatedWindow).toBeUndefined();
    });

    it("returns allowed=false the moment ANY window exceeds its limit", async () => {
      const { store } = makeStore();
      let now = 0;
      const svc = new ThrottlerService(store, { now: () => now });
      // Limit on 1s = 5. Six hits within 1s must trip it.
      const tight = [{ name: "1s", limit: 5, ttlMs: 1_000 }];
      for (let i = 0; i < 5; i++) {
        const r = await svc.consume({ key: "u-1", windows: tight });
        expect(r.allowed).toBe(true);
        now += 50;
      }
      const blocked = await svc.consume({ key: "u-1", windows: tight });
      expect(blocked.allowed).toBe(false);
      expect(blocked.violatedWindow).toBe("1s");
    });

    it("reports the FIRST violating window (most-restrictive wins by ordering)", async () => {
      const { store } = makeStore();
      const svc = new ThrottlerService(store, { now: () => 0 });
      // Same key tracked by both windows; both will be over after enough hits.
      const both: ThrottleWindow[] = [
        { name: "short", limit: 1, ttlMs: 60_000 },
        { name: "long", limit: 1, ttlMs: 60_000 },
      ];
      await svc.consume({ key: "u-1", windows: both }); // first hit allowed
      const blocked = await svc.consume({ key: "u-1", windows: both });
      expect(blocked.allowed).toBe(false);
      expect(blocked.violatedWindow).toBe("short");
    });

    it("isolates buckets across keys (per-user, per-IP, per-API-Key)", async () => {
      const { store } = makeStore();
      const svc = new ThrottlerService(store, { now: () => 0 });
      const tight = [{ name: "1s", limit: 1, ttlMs: 1_000 }];
      await svc.consume({ key: "user:a", windows: tight });
      const otherUser = await svc.consume({ key: "user:b", windows: tight });
      expect(otherUser.allowed).toBe(true);
    });

    it("rejects an empty windows array (footgun guard)", async () => {
      const { store } = makeStore();
      const svc = new ThrottlerService(store, { now: () => 0 });
      await expect(svc.consume({ key: "k", windows: [] })).rejects.toThrow(/windows/i);
    });
  });
});
