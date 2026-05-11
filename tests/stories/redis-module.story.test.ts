import { describe, expect, it } from "vitest";

/**
 * Story · RedisModule + RedisClient provider.
 *
 * Tests the no-Redis fallback path (REDIS_URL not set) — callers
 * receive `null` and must guard accordingly. Redis-connected behaviour
 * is verified at the integration layer only when REDIS_URL is
 * available.
 */

describe("Story · RedisClient provider (no-Redis fallback)", () => {
  it("resolveRedisClient() returns null when REDIS_URL is not set", async () => {
    const { resolveRedisClient } = await import("../../src/core/redis/redis-client.js");
    const client = await resolveRedisClient(undefined);
    expect(client).toBeNull();
  });

  it("resolveRedisClient() returns null for empty REDIS_URL", async () => {
    const { resolveRedisClient } = await import("../../src/core/redis/redis-client.js");
    const client = await resolveRedisClient("");
    expect(client).toBeNull();
  });
});

describe("Story · RedisNewDeviceThrottle (no-Redis fallback)", () => {
  it("createRedisNewDeviceThrottle() works with null redis — falls back to in-memory", async () => {
    const { createRedisNewDeviceThrottle } = await import(
      "../../src/core/redis/redis-new-device-throttle.js"
    );
    const now = { value: 1000 };
    const throttle = createRedisNewDeviceThrottle({
      redis: null,
      windowMs: 60_000,
      now: () => now.value,
    });
    // First check: allowed
    const first = throttle.check("user-1");
    expect(first.allowed).toBe(true);
    throttle.record("user-1");
    // Immediate second check within window: denied
    const second = throttle.check("user-1");
    expect(second.allowed).toBe(false);
  });

  it("createRedisNewDeviceThrottle() resets after window elapses", async () => {
    const { createRedisNewDeviceThrottle } = await import(
      "../../src/core/redis/redis-new-device-throttle.js"
    );
    const now = { value: 1000 };
    const throttle = createRedisNewDeviceThrottle({
      redis: null,
      windowMs: 100,
      now: () => now.value,
    });
    throttle.record("user-2");
    now.value += 200; // beyond window
    const result = throttle.check("user-2");
    expect(result.allowed).toBe(true);
  });
});

describe("Story · RedisPermissionCache (no-Redis fallback)", () => {
  it("createRedisPermissionCache() returns null on cache miss when no redis", async () => {
    const { createRedisPermissionCache } = await import(
      "../../src/core/redis/redis-permission-cache.js"
    );
    const cache = createRedisPermissionCache({ redis: null, ttlMs: 5000 });
    const result = await cache.get("user-1", "tenant-1");
    expect(result).toBeNull();
  });

  it("createRedisPermissionCache() stores and retrieves via in-memory fallback", async () => {
    const { createRedisPermissionCache } = await import(
      "../../src/core/redis/redis-permission-cache.js"
    );
    const cache = createRedisPermissionCache({ redis: null, ttlMs: 5000 });
    const fakeEntry = { ability: { can: () => false } as unknown, expiresAt: Date.now() + 5000 };
    await cache.set("user-1", "tenant-1", fakeEntry as never);
    const retrieved = await cache.get("user-1", "tenant-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved).toMatchObject({ expiresAt: fakeEntry.expiresAt });
  });
});

describe("Story · RedisRecipientRateLimiter (no-Redis fallback)", () => {
  it("createRedisRecipientRateLimiter().consume() allows first send", async () => {
    const { createRedisRecipientRateLimiter } = await import(
      "../../src/core/redis/redis-recipient-rate-limiter.js"
    );
    const limiter = createRedisRecipientRateLimiter({
      redis: null,
      limit: 3,
      windowMs: 60_000,
    });
    const decision = await limiter.consume("test@example.com");
    expect(decision.allowed).toBe(true);
  });

  it("createRedisRecipientRateLimiter().consume() denies when limit exceeded", async () => {
    const { createRedisRecipientRateLimiter } = await import(
      "../../src/core/redis/redis-recipient-rate-limiter.js"
    );
    const limiter = createRedisRecipientRateLimiter({
      redis: null,
      limit: 2,
      windowMs: 60_000,
    });
    await limiter.consume("rate@example.com");
    await limiter.consume("rate@example.com");
    const third = await limiter.consume("rate@example.com");
    expect(third.allowed).toBe(false);
  });
});
