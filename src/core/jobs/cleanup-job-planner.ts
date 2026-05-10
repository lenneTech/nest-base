/**
 * Pure planner — cleanup-cron pg-boss schedule plan (issue #127 Finding 1).
 *
 * Translates a cleanup-job kind into the pg-boss registration triple:
 *   - `queueName` — unique name for `boss.work()` + `boss.schedule()`
 *   - `cron`      — standard 5-field cron expression
 *   - `singletonKey` — advisory-lock key so pg-boss guarantees at-most-
 *     one running instance across replicas at any given cron tick
 *
 * The planner is pure so the scheduling contract is testable without a
 * live pg-boss or Postgres connection. The runner (each cleanup cron's
 * `onModuleInit`) calls this planner, then issues `boss.work()` +
 * `boss.schedule()` with the result.
 *
 * Cron cadences mirror the existing setInterval cadences:
 *   - throttler:    hourly  → "0 * * * *"
 *   - idempotency:  daily   → "0 0 * * *"
 *   - verification: daily   → "0 0 * * *"
 *   - geoip:        daily   → "0 0 * * *"
 */

/** Recognised cleanup job kinds — one per cron task. */
export type CleanupKind = "throttler" | "idempotency" | "verification" | "geoip";

export interface CleanupJobPlanInput {
  readonly kind: CleanupKind;
}

export interface CleanupJobPlan {
  /** pg-boss queue name — passed to `boss.work()` + `boss.schedule()`. */
  readonly queueName: string;
  /** Standard 5-field cron expression aligned with the existing setInterval cadence. */
  readonly cron: string;
  /**
   * Singleton key — pg-boss uses this as the advisory-lock identifier
   * so only one replica executes the job per scheduled slot.
   */
  readonly singletonKey: string;
}

/** Prefix keeps our queues visually grouped in the pg-boss schema. */
const QUEUE_PREFIX = "lt.cleanup";

const PLAN_MAP: Record<CleanupKind, Pick<CleanupJobPlan, "queueName" | "cron">> = {
  throttler: {
    queueName: `${QUEUE_PREFIX}.throttler`,
    // Hourly — matches THROTTLER_CLEANUP_INTERVAL_MS (3_600_000 ms).
    cron: "0 * * * *",
  },
  idempotency: {
    queueName: `${QUEUE_PREFIX}.idempotency`,
    // Daily at midnight — matches IDEMPOTENCY_CLEANUP_INTERVAL_MS (86_400_000 ms).
    cron: "0 0 * * *",
  },
  verification: {
    queueName: `${QUEUE_PREFIX}.verification`,
    // Daily at midnight — matches VERIFICATION_CLEANUP_INTERVAL_MS (86_400_000 ms).
    cron: "0 0 * * *",
  },
  geoip: {
    queueName: `${QUEUE_PREFIX}.geoip`,
    // Daily — matches the GeoIP refresh tick (24h).
    cron: "0 0 * * *",
  },
};

/**
 * Pure function: given a cleanup kind, returns the pg-boss schedule plan.
 * No I/O; safe to call from tests without a database.
 */
export function buildCleanupJobPlan(input: CleanupJobPlanInput): CleanupJobPlan {
  const entry = PLAN_MAP[input.kind];
  return {
    queueName: entry.queueName,
    cron: entry.cron,
    // The singleton key mirrors the queue name — they're co-located in
    // the same pg-boss namespace so no additional uniqueness strategy
    // is needed. Using the queue name directly keeps the relationship
    // obvious and avoids a second lookup table.
    singletonKey: entry.queueName,
  };
}
