/**
 * Pure planner — cleanup-cron BullMQ schedule plan.
 *
 * Mirrors `cleanup-job-planner.ts` for pg-boss but emits the BullMQ
 * `repeat` job options shape:
 *   - `queueName`      — BullMQ Queue name
 *   - `repeatPattern`  — standard 5-field cron expression
 *   - `jobId`          — fixed id replaces pg-boss `singletonKey`;
 *     BullMQ deduplicates jobs that share the same (queue, jobId)
 *     so only one replica executes per scheduled slot.
 *
 * The planner is pure — no BullMQ imports, no I/O — so tests run
 * without a live Redis connection.
 */

import type { CleanupKind } from "./cleanup-job-planner.js";

export interface BullMQCleanupJobPlanInput {
  readonly kind: CleanupKind;
}

export interface BullMQCleanupJobPlan {
  /** BullMQ Queue name — used for `new Queue(queueName)` + `new Worker(queueName, …)`. */
  readonly queueName: string;
  /** Standard 5-field cron expression passed to BullMQ `repeat.pattern`. */
  readonly repeatPattern: string;
  /**
   * Fixed job id — BullMQ's deduplication key. A repeat job with the same
   * (queue, jobId) won't enqueue a second instance while the previous one
   * is still waiting. This replaces pg-boss's `singletonKey`.
   */
  readonly jobId: string;
}

const QUEUE_PREFIX = "lt.cleanup";

const PLAN_MAP: Record<CleanupKind, Pick<BullMQCleanupJobPlan, "queueName" | "repeatPattern">> = {
  throttler: {
    queueName: `${QUEUE_PREFIX}.throttler`,
    // Hourly — matches THROTTLER_CLEANUP_INTERVAL_MS (3_600_000 ms).
    repeatPattern: "0 * * * *",
  },
  idempotency: {
    queueName: `${QUEUE_PREFIX}.idempotency`,
    // Daily at midnight — matches IDEMPOTENCY_CLEANUP_INTERVAL_MS (86_400_000 ms).
    repeatPattern: "0 0 * * *",
  },
  verification: {
    queueName: `${QUEUE_PREFIX}.verification`,
    // Daily at midnight — matches VERIFICATION_CLEANUP_INTERVAL_MS (86_400_000 ms).
    repeatPattern: "0 0 * * *",
  },
  geoip: {
    queueName: `${QUEUE_PREFIX}.geoip`,
    // Daily — matches the GeoIP refresh tick (24h).
    repeatPattern: "0 0 * * *",
  },
};

/**
 * Pure function: given a cleanup kind, returns the BullMQ schedule plan.
 * No I/O; safe to call from tests without a database or Redis connection.
 */
export function buildBullMQCleanupJobPlan(input: BullMQCleanupJobPlanInput): BullMQCleanupJobPlan {
  const entry = PLAN_MAP[input.kind];
  return {
    queueName: entry.queueName,
    repeatPattern: entry.repeatPattern,
    // Mirror the pg-boss convention: singleton key === queue name so the
    // relationship is obvious and avoids a second lookup table.
    jobId: entry.queueName,
  };
}
