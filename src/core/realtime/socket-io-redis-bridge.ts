/** Minimal ioredis surface required by `@socket.io/redis-adapter`. */
export interface RedisAdapterClient {
  duplicate(): RedisAdapterClient;
  quit(): Promise<string>;
  on(event: string, listener: (...args: unknown[]) => void): this;
}

interface IoredisAdapterSource {
  duplicate(): IoredisAdapterSource;
  quit(): Promise<string>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export function toRedisAdapterClient(client: IoredisAdapterSource): RedisAdapterClient {
  return {
    duplicate: () => toRedisAdapterClient(client.duplicate()),
    quit: () => client.quit(),
    on: (event, listener) => {
      client.on(event, listener);
      return toRedisAdapterClient(client);
    },
  };
}
