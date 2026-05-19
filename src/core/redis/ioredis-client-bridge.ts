import type { RedisClientLike } from "./redis-client.js";

/** Minimal ioredis surface mapped into `RedisClientLike`. */
interface IoredisClientSource {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<string | null>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
  del(...keys: string[]): Promise<number>;
  duplicate(): IoredisClientSource;
  disconnect(): void;
  status: string;
  quit(): Promise<string>;
  scan(
    cursor: string,
    matchFlag: "MATCH",
    pattern: string,
    countFlag: "COUNT",
    count: number,
  ): Promise<[string, string[]]>;
  scanStream(opts: { match: string; count: number }): AsyncIterable<string[]>;
}

export function toRedisClientLike(client: IoredisClientSource): RedisClientLike {
  return {
    get: (key) => client.get(key),
    set: (key, value, ...args) => client.set(key, value, ...args),
    setex: (key, seconds, value) => client.setex(key, seconds, value),
    incr: (key) => client.incr(key),
    pexpire: (key, ms) => client.pexpire(key, ms),
    del: (...keys) => client.del(...keys),
    duplicate: () => toRedisClientLike(client.duplicate()),
    disconnect: () => client.disconnect(),
    status: client.status,
    quit: () => client.quit(),
    scan: (cursor, matchFlag, pattern, countFlag, count) =>
      client.scan(cursor, matchFlag, pattern, countFlag, count),
    scanStream: (opts) => client.scanStream(opts),
  };
}
