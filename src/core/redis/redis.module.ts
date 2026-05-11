import { Global, Module } from "@nestjs/common";

import { resolveRedisClient } from "./redis-client.js";

/**
 * `REDIS_CLIENT` injection token.
 *
 * Resolves to a connected ioredis instance when `REDIS_URL` is set,
 * or `null` when Redis is not configured. Every consumer MUST guard:
 *
 * ```typescript
 * constructor(@Optional() @Inject(REDIS_CLIENT) private readonly redis: RedisClientLike | null) {}
 * ```
 */
export const REDIS_CLIENT = Symbol.for("lt:RedisClient");

/**
 * RedisModule — thin global module that resolves a shared ioredis
 * connection and exposes it under the `REDIS_CLIENT` token.
 *
 * Registered as `@Global()` so consumers don't need to import it
 * individually — the `AppModule` imports it once and every module
 * receives the token automatically.
 *
 * Graceful degradation: when `REDIS_URL` is not set the provider
 * resolves to `null`. No connection attempt is made, no errors
 * are thrown, and all Redis-backed features fall back to their
 * in-memory implementations silently.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => resolveRedisClient(process.env.REDIS_URL),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
