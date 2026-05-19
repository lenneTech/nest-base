import { Logger } from "@nestjs/common";

import type { RedisDuplex } from "./bullmq-job-queue.js";

const redisDuplexLogger = new Logger("RedisDuplex");

/** Attached by `toRedisDuplex()` so BullMQ receives a real ioredis connection. */
export const IOREDIS_RAW = Symbol.for("lt:ioredisRaw");

/** Minimal ioredis surface used to build a `RedisDuplex` bridge. */
export interface IoredisDuplexSource {
  duplicate(): IoredisDuplexSource;
  disconnect(): void;
  status: string;
  quit(): Promise<string>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
}

export type RedisDuplexWithRaw = RedisDuplex & {
  [IOREDIS_RAW]: IoredisDuplexSource;
};

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
 * The raw client is preserved under `IOREDIS_RAW` for BullMQ / Socket.IO.
 */
export function toRedisDuplex(client: IoredisDuplexSource): RedisDuplexWithRaw {
  attachErrorHandler(client);
  const wrapped: RedisDuplexWithRaw = {
    duplicate: () => toRedisDuplex(client.duplicate()),
    disconnect: () => client.disconnect(),
    status: client.status,
    quit: () => client.quit(),
    [IOREDIS_RAW]: client,
  };
  return wrapped;
}

/** Unwrap the backing ioredis instance for libraries that need the full client. */
export function unwrapIoredisRaw(redis: RedisDuplex): IoredisDuplexSource {
  const raw = (redis as RedisDuplexWithRaw)[IOREDIS_RAW];
  if (!raw) {
    throw new Error("RedisDuplex is missing IOREDIS_RAW — expected a toRedisDuplex() wrapper");
  }
  return raw;
}
