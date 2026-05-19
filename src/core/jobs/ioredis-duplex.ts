import { Logger } from "@nestjs/common";

import type { RedisDuplex } from "./bullmq-job-queue.js";

const redisDuplexLogger = new Logger("RedisDuplex");

/** Minimal ioredis surface used to build a `RedisDuplex` bridge. */
interface IoredisDuplexSource {
  duplicate(): IoredisDuplexSource;
  disconnect(): void;
  status: string;
  quit(): Promise<string>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

function attachErrorHandler(client: IoredisDuplexSource): void {
  if (typeof client.on !== "function") return;
  client.on("error", (err: unknown) => {
    redisDuplexLogger.error(
      `ioredis connection error: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

/**
 * Wrap a live ioredis client as `RedisDuplex` without escape-hatch casts.
 */
export function toRedisDuplex(client: IoredisDuplexSource): RedisDuplex {
  attachErrorHandler(client);
  return {
    duplicate: () => toRedisDuplex(client.duplicate()),
    disconnect: () => client.disconnect(),
    status: client.status,
    quit: () => client.quit(),
  };
}
