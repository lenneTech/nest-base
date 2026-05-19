import type { ConnectionOptions } from "bullmq";

import type { RedisDuplex } from "./bullmq-job-queue.js";

/**
 * Bridge our narrow `RedisDuplex` surface to BullMQ's `ConnectionOptions`.
 * ioredis instances satisfy both; this is the single typed boundary.
 */
export function bullmqRedisConnection(redis: RedisDuplex): ConnectionOptions {
  return redis as ConnectionOptions;
}
