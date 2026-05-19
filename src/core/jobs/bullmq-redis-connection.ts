import type { ConnectionOptions } from "bullmq";

import type { RedisDuplex } from "./bullmq-job-queue.js";
import { unwrapIoredisRaw } from "./ioredis-duplex.js";

/**
 * Bridge our `RedisDuplex` wrapper to BullMQ's `ConnectionOptions`.
 * BullMQ must receive the real ioredis instance (auth, duplicate, etc.).
 */
export function bullmqRedisConnection(redis: RedisDuplex): ConnectionOptions {
  return unwrapIoredisRaw(redis) as ConnectionOptions;
}
