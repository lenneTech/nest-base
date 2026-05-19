import type { RedisDuplex } from "./bullmq-job-queue.js";

/** Minimal ioredis surface used to build a `RedisDuplex` bridge. */
interface IoredisDuplexSource {
  duplicate(): IoredisDuplexSource;
  disconnect(): void;
  status: string;
  quit(): Promise<string>;
}

/**
 * Wrap a live ioredis client as `RedisDuplex` without escape-hatch casts.
 */
export function toRedisDuplex(client: IoredisDuplexSource): RedisDuplex {
  return {
    duplicate: () => toRedisDuplex(client.duplicate()),
    disconnect: () => client.disconnect(),
    status: client.status,
    quit: () => client.quit(),
  };
}
