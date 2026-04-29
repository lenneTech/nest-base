import { describe, expect, it } from "vitest";

import {
  IdempotencyConflictError,
  IdempotencyService,
  computeRequestHash,
  type IdempotencyRecord,
  type IdempotencyStore,
} from "../../src/core/idempotency/idempotency.service.js";

/**
 * Story · Idempotency-Key (PLAN.md §19.6 + §32 Phase 8).
 *
 * Stripe-style idempotency:
 *
 *   1. Client sends `Idempotency-Key: <uuid>` on POST/PATCH.
 *   2. Server hashes (method + path + body) into a request fingerprint.
 *   3. Lookup the key in the store:
 *        - hit  + same fingerprint → return cached status + body
 *        - hit  + different print  → 409 Conflict
 *        - miss → run handler, cache the response under the key
 *
 * The interceptor wiring (NestJS layer) lives in a follow-up slice;
 * this slice ships the pure service that owns the lookup / store /
 * conflict logic.
 */
describe("Story · Idempotency service", () => {
  function inMemoryStore(): IdempotencyStore & { records: Map<string, IdempotencyRecord> } {
    const records = new Map<string, IdempotencyRecord>();
    return {
      records,
      async get(key) {
        return records.get(key) ?? null;
      },
      async put(record) {
        records.set(record.key, record);
      },
      async delete(key) {
        records.delete(key);
      },
    };
  }

  function makeRequest(overrides: { method?: string; path?: string; body?: unknown } = {}): {
    method: string;
    path: string;
    body: unknown;
  } {
    return {
      method: "POST",
      path: "/projects",
      body: { name: "Quarterly Plan" },
      ...overrides,
    };
  }

  describe("computeRequestHash()", () => {
    it("returns the same hash for the same request shape", () => {
      const a = computeRequestHash(makeRequest());
      const b = computeRequestHash(makeRequest());
      expect(a).toBe(b);
    });

    it("differs when the body changes", () => {
      const a = computeRequestHash(makeRequest({ body: { name: "A" } }));
      const b = computeRequestHash(makeRequest({ body: { name: "B" } }));
      expect(a).not.toBe(b);
    });

    it("differs when the path changes", () => {
      const a = computeRequestHash(makeRequest({ path: "/projects" }));
      const b = computeRequestHash(makeRequest({ path: "/orders" }));
      expect(a).not.toBe(b);
    });

    it("is method-aware (POST and PATCH on the same body must differ)", () => {
      const a = computeRequestHash(makeRequest({ method: "POST" }));
      const b = computeRequestHash(makeRequest({ method: "PATCH" }));
      expect(a).not.toBe(b);
    });

    it("returns a 64-char lowercase hex string (sha256)", () => {
      expect(computeRequestHash(makeRequest())).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe("IdempotencyService.runOrCache()", () => {
    it("runs the handler on a cache miss and stores the response", async () => {
      const store = inMemoryStore();
      const svc = new IdempotencyService(store, { now: () => 0, ttlMs: 60_000 });
      const result = await svc.runOrCache({
        key: "k-1",
        request: makeRequest(),
        handler: async () => ({ status: 201, body: { id: "p-1" } }),
      });
      expect(result).toEqual({ status: 201, body: { id: "p-1" }, replayed: false });
      // Anonymous calls land under the "anon::" prefix so they cannot
      // collide with later authenticated calls using the same key.
      expect(store.records.has("anon::k-1")).toBe(true);
    });

    it("returns the cached response on a hit with matching fingerprint", async () => {
      const store = inMemoryStore();
      const svc = new IdempotencyService(store, { now: () => 0, ttlMs: 60_000 });
      const request = makeRequest();
      await svc.runOrCache({
        key: "k-1",
        request,
        handler: async () => ({ status: 201, body: { id: "p-1" } }),
      });
      let handlerCalled = false;
      const result = await svc.runOrCache({
        key: "k-1",
        request,
        handler: async () => {
          handlerCalled = true;
          return { status: 500, body: { id: "never" } };
        },
      });
      expect(result).toEqual({ status: 201, body: { id: "p-1" }, replayed: true });
      expect(handlerCalled).toBe(false);
    });

    it("throws IdempotencyConflictError on a hit with a different fingerprint", async () => {
      const store = inMemoryStore();
      const svc = new IdempotencyService(store, { now: () => 0, ttlMs: 60_000 });
      await svc.runOrCache({
        key: "k-1",
        request: makeRequest({ body: { name: "A" } }),
        handler: async () => ({ status: 201, body: {} }),
      });
      await expect(
        svc.runOrCache({
          key: "k-1",
          request: makeRequest({ body: { name: "B" } }),
          handler: async () => ({ status: 201, body: {} }),
        }),
      ).rejects.toThrow(IdempotencyConflictError);
    });

    it("treats expired records as a cache miss (handler runs again, record refreshed)", async () => {
      const store = inMemoryStore();
      let now = 0;
      const svc = new IdempotencyService(store, { now: () => now, ttlMs: 60_000 });
      await svc.runOrCache({
        key: "k-1",
        request: makeRequest(),
        handler: async () => ({ status: 201, body: { round: 1 } }),
      });
      now = 60_001;
      const result = await svc.runOrCache({
        key: "k-1",
        request: makeRequest(),
        handler: async () => ({ status: 201, body: { round: 2 } }),
      });
      expect(result.body).toEqual({ round: 2 });
      expect(result.replayed).toBe(false);
    });

    it("does not cache a handler that threw", async () => {
      const store = inMemoryStore();
      const svc = new IdempotencyService(store, { now: () => 0, ttlMs: 60_000 });
      await expect(
        svc.runOrCache({
          key: "k-1",
          request: makeRequest(),
          handler: async () => {
            throw new Error("boom");
          },
        }),
      ).rejects.toThrow(/boom/);
      expect(store.records.has("anon::k-1")).toBe(false);
    });

    it("records expiresAt = now + ttlMs", async () => {
      const store = inMemoryStore();
      const svc = new IdempotencyService(store, { now: () => 1000, ttlMs: 60_000 });
      await svc.runOrCache({
        key: "k-1",
        request: makeRequest(),
        handler: async () => ({ status: 201, body: {} }),
      });
      expect(store.records.get("anon::k-1")?.expiresAt).toBe(61_000);
    });

    it("forwards userId on the stored record when provided", async () => {
      const store = inMemoryStore();
      const svc = new IdempotencyService(store, { now: () => 0, ttlMs: 60_000 });
      await svc.runOrCache({
        key: "k-1",
        request: makeRequest(),
        userId: "u-42",
        handler: async () => ({ status: 201, body: {} }),
      });
      // Storage key is user-scoped (`u-42::k-1`); the record carries
      // the userId for audit / debugging.
      const stored = [...store.records.values()].find((r) => r.userId === "u-42");
      expect(stored).toBeDefined();
      expect(stored?.key).toBe("u-42::k-1");
    });

    describe("user-scoped lookup (cross-user isolation)", () => {
      it("does NOT return user A's cached response to user B (same key, same body)", async () => {
        // Why: idempotency keys are client-supplied. If they're guessable
        // (UUID v7 is monotonic) and the lookup is global, user B can
        // retrieve user A's response by replaying the same request +
        // key. Lookups MUST be scoped to the userId.
        const store = inMemoryStore();
        const svc = new IdempotencyService(store, { now: () => 0, ttlMs: 60_000 });
        const request = makeRequest();

        const aResult = await svc.runOrCache({
          key: "shared-key",
          request,
          userId: "user-A",
          handler: async () => ({ status: 201, body: { id: "A-resource" } }),
        });
        expect(aResult.body).toEqual({ id: "A-resource" });

        let bHandlerCalled = false;
        const bResult = await svc.runOrCache({
          key: "shared-key",
          request,
          userId: "user-B",
          handler: async () => {
            bHandlerCalled = true;
            return { status: 201, body: { id: "B-resource" } };
          },
        });
        expect(bHandlerCalled).toBe(true);
        expect(bResult.body).toEqual({ id: "B-resource" });
        expect(bResult.replayed).toBe(false);
      });

      it("anonymous calls (no userId) are isolated from user-scoped calls with the same key", async () => {
        const store = inMemoryStore();
        const svc = new IdempotencyService(store, { now: () => 0, ttlMs: 60_000 });
        const request = makeRequest();

        await svc.runOrCache({
          key: "anon-key",
          request,
          handler: async () => ({ status: 201, body: { who: "anon" } }),
        });

        const result = await svc.runOrCache({
          key: "anon-key",
          request,
          userId: "u-1",
          handler: async () => ({ status: 201, body: { who: "u-1" } }),
        });
        expect(result.body).toEqual({ who: "u-1" });
        expect(result.replayed).toBe(false);
      });

      it("same user with same key replays correctly (regression: scoping must not break replay)", async () => {
        const store = inMemoryStore();
        const svc = new IdempotencyService(store, { now: () => 0, ttlMs: 60_000 });
        const request = makeRequest();

        await svc.runOrCache({
          key: "k-1",
          request,
          userId: "u-1",
          handler: async () => ({ status: 201, body: { id: "first" } }),
        });
        const second = await svc.runOrCache({
          key: "k-1",
          request,
          userId: "u-1",
          handler: async () => ({ status: 500, body: { id: "should-not-run" } }),
        });
        expect(second.body).toEqual({ id: "first" });
        expect(second.replayed).toBe(true);
      });
    });
  });
});
