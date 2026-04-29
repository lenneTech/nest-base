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
      expect(store.records.has("k-1")).toBe(true);
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
      expect(store.records.has("k-1")).toBe(false);
    });

    it("records expiresAt = now + ttlMs", async () => {
      const store = inMemoryStore();
      const svc = new IdempotencyService(store, { now: () => 1000, ttlMs: 60_000 });
      await svc.runOrCache({
        key: "k-1",
        request: makeRequest(),
        handler: async () => ({ status: 201, body: {} }),
      });
      expect(store.records.get("k-1")?.expiresAt).toBe(61_000);
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
      expect(store.records.get("k-1")?.userId).toBe("u-42");
    });
  });
});
