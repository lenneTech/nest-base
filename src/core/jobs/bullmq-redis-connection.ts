import type { ConnectionOptions } from "bullmq";

import type { RedisDuplex } from "./bullmq-job-queue.js";
import { unwrapIoredisRaw } from "./ioredis-duplex.js";

/**
 * ioredis options required for BullMQ queues/workers.
 * Workers use blocking commands (BRPOP); ioredis defaults `maxRetriesPerRequest`
 * to 20, which BullMQ rejects — it must be `null`.
 */
export const BULLMQ_IORedis_OPTIONS = {
  maxRetriesPerRequest: null,
} as const;

/**
 * Bridge our `RedisDuplex` wrapper to BullMQ's `ConnectionOptions`.
 * BullMQ must receive the real ioredis instance (auth, duplicate, etc.).
 */
export function bullmqRedisConnection(redis: RedisDuplex): ConnectionOptions {
  return unwrapIoredisRaw(redis) as ConnectionOptions;
}
