/**
 * RedisClient factory.
 *
 * Single source of truth for creating an ioredis connection. Exported
 * as a pure async function so it can be injected via NestJS useFactory
 * and tested without booting the full module.
 *
 * Returns `null` when `REDIS_URL` is absent or empty — every caller
 * MUST handle the null case with an in-memory fallback. This is the
 * central degradation contract for the Redis feature set.
 */

/**
 * Minimal ioredis interface callers use. Kept narrow so tests can
 * supply simple fakes without importing ioredis types.
 */
export interface RedisClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
  /** EX NX SET — set key with TTL only if it does not already exist. */
  set(key: string, value: string, exFlag: "EX", seconds: number, nxFlag: "NX"): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  /** NX SET — returns "OK" if key was set, null if it already existed. */
  set(key: string, value: string, flag: "NX", px: "PX", ms: number): Promise<string | null>;
  duplicate(): RedisClientLike;
  disconnect(): void;
  status: string;
  quit(): Promise<string>;
}

/**
 * Resolves an ioredis client.
 *
 * `resolveRedisClient(undefined)` → null (REDIS_URL not set)
 * `resolveRedisClient("")`        → null (explicitly empty)
 * `resolveRedisClient("redis://…")` → connected ioredis instance
 *
 * The returned client is not yet connected — ioredis connects lazily
 * on the first command.
 */
export async function resolveRedisClient(
  redisUrl: string | undefined,
): Promise<RedisClientLike | null> {
  if (!redisUrl) return null;
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl);
    // Prevent unhandled 'error' event crash on auth failures, network drops,
    // or TLS rejections. ioredis surfaces these via its internal retry logic;
    // commands reject individually instead of crashing the process.
    client.on("error", (err: Error) => {
      process.stderr.write(`[ioredis] connection error: ${err.message}\n`);
    });
    return client as unknown as RedisClientLike;
  } catch {
    // ioredis not available or URL invalid — degrade gracefully.
    return null;
  }
}
