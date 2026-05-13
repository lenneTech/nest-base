import { Global, Inject, Injectable, Module, Optional, type OnModuleDestroy } from "@nestjs/common";

import { type RedisClientLike, resolveRedisClient } from "./redis-client.js";

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
 * Lifecycle hook that gracefully closes the shared ioredis connection
 * on module teardown. Without this the process lingers after `app.close()`
 * because the TCP socket keeps the event loop alive.
 */
@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Optional() @Inject(REDIS_CLIENT) private readonly client: RedisClientLike | null) {}

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    const status = this.client.status;
    if (status === "ready" || status === "connect") {
      // Prefer a clean QUIT handshake; fall back to a hard disconnect on
      // timeout / error so the process always exits promptly.
      await this.client.quit().catch(() => this.client!.disconnect());
    }
  }
}

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
    RedisLifecycle,
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
