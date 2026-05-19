import { afterAll, describe, expect, it } from "vitest";

const redisUrl = process.env.TEST_REDIS_URL ?? process.env.REDIS_URL;

describe.skipIf(!redisUrl)("Story · Redis adapters (live Redis)", () => {
  let client: Awaited<ReturnType<typeof import("../../src/core/redis/redis-client.js").resolveRedisClient>>;

  afterAll(async () => {
    if (client) {
      await client.quit();
    }
  });

  it("resolveRedisClient() connects and round-trips GET/SET", async () => {
    const { resolveRedisClient } = await import("../../src/core/redis/redis-client.js");
    client = await resolveRedisClient(redisUrl);
    expect(client).not.toBeNull();
    const key = `lt:test:${crypto.randomUUID()}`;
    await client!.setex(key, 30, "ping");
    expect(await client!.get(key)).toBe("ping");
    await client!.del(key);
  });

  it("createRedisPermissionCache() stores and reads ability rules in Redis", async () => {
    const { createRedisPermissionCache } =
      await import("../../src/core/redis/redis-permission-cache.js");
    const { buildAbility } = await import("../../src/core/permissions/casl-ability.js");

    const cache = createRedisPermissionCache({ redis: client, ttlMs: 5000 });
    const ability = buildAbility([{ action: "read", subject: "User" }]);
    const expiresAt = Date.now() + 5000;
    await cache.set("user-redis", "tenant-redis", { ability, expiresAt });

    const hit = await cache.get("user-redis", "tenant-redis");
    expect(hit).not.toBeNull();
    expect(hit!.ability.can("read", "User")).toBe(true);

    await cache.invalidate("user-redis", "tenant-redis");
    expect(await cache.get("user-redis", "tenant-redis")).toBeNull();
  });

  it("createRedisNewDeviceThrottle() enforces window in Redis", async () => {
    const { createRedisNewDeviceThrottle } =
      await import("../../src/core/redis/redis-new-device-throttle.js");
    const userId = `user-${crypto.randomUUID()}`;
    const throttle = createRedisNewDeviceThrottle({
      redis: client,
      windowMs: 60_000,
    });

    expect(throttle.check(userId).allowed).toBe(true);
    throttle.record(userId);
    expect(throttle.check(userId).allowed).toBe(false);
  });

  it("createRedisRecipientRateLimiter().consume() enforces limit in Redis", async () => {
    const { createRedisRecipientRateLimiter } =
      await import("../../src/core/redis/redis-recipient-rate-limiter.js");
    const recipient = `test-${crypto.randomUUID()}@example.com`;
    const limiter = createRedisRecipientRateLimiter({
      redis: client,
      limit: 2,
      windowMs: 60_000,
    });

    expect((await limiter.consume(recipient)).allowed).toBe(true);
    expect((await limiter.consume(recipient)).allowed).toBe(true);
    expect((await limiter.consume(recipient)).allowed).toBe(false);
  });
});
