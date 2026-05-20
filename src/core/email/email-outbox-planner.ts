/**
 * Email-Outbox planners.
 *
 * Pure helpers used by `EmailOutboxWorker` and `EmailOutboxRecorder`
 * — backoff math, retry-eligibility, claim-staleness. Splitting them
 * out keeps the worker dispatch loop a thin runner so the
 * scheduling logic is unit-testable without DB or driver wiring.
 */

/** Terminal status values produced by the worker or admin actions for a record. */
export type EmailOutboxTerminalStatus = "sent" | "dead-letter" | "cancelled";

/** All status values an email-outbox record can hold. */
export type EmailOutboxStatus = "pending" | EmailOutboxTerminalStatus;

/**
 * Error classification — drives retry vs. immediate dead-letter.
 *
 * - `transient`: connection refused, 5xx, timeout — worth retrying.
 * - `permanent`: invalid recipient, 4xx-not-rate-limit — never retry.
 */
export type EmailOutboxErrorKind = "transient" | "permanent";

export interface EmailOutboxRetryConfig {
  /** Delay applied between attempt 1 and attempt 2. */
  initialDelayMs: number;
  /** Multiplier applied per additional attempt. */
  factor: number;
  /** Hard ceiling — backoff is min(factor^n * initial, maxDelayMs). */
  maxDelayMs: number;
  /**
   * Inclusive upper bound on attempts. When a failure pushes
   * `attemptCount` to `maxAttempts`, the record transitions to
   * `dead-letter` instead of being scheduled for another try.
   */
  maxAttempts: number;
}

/**
 * Default retry policy: 1m, 5m, 25m, 2h cap, 5 attempts total.
 *
 * Aligned with issue #11's "max 5 attempts, then dead-letter"
 * acceptance criterion. Numbers picked so a Brevo / SMTP outage <2h
 * is recoverable without manual replay; longer outages surface as
 * dead-letter records that operators can inspect via the hub.
 */
export const DEFAULT_EMAIL_OUTBOX_RETRY: EmailOutboxRetryConfig = {
  initialDelayMs: 60_000,
  factor: 5,
  maxDelayMs: 2 * 60 * 60 * 1000,
  maxAttempts: 5,
};

/**
 * Crash-safety threshold: a `claimedAt` older than this means the
 * worker that picked the record up never released it (process died,
 * deploy rolled, etc.) — the next worker tick is allowed to steal
 * the claim and retry.
 */
export const STALE_CLAIM_THRESHOLD_MS = 30_000;

export interface PlanEmailRetryInput {
  /** 1-based count: 1 means "the first attempt just failed". */
  attemptCount: number;
  errorKind: EmailOutboxErrorKind;
  now: Date;
  config: EmailOutboxRetryConfig;
}

export interface PlanEmailRetryResult {
  terminal: boolean;
  /** Absent when `terminal === true`. */
  nextAttemptAt?: Date;
}

/**
 * Plans the next attempt after a failure. Returns either
 * `{ terminal: true }` (record graduates to dead-letter) or
 * `{ terminal: false, nextAttemptAt }` (record stays pending and gets
 * picked up at or after `nextAttemptAt`).
 */
export function planEmailRetry(input: PlanEmailRetryInput): PlanEmailRetryResult {
  const { attemptCount, errorKind, now, config } = input;
  if (attemptCount < 1 || !Number.isInteger(attemptCount)) {
    throw new Error(
      `planEmailRetry: attemptCount must be a positive integer (got ${attemptCount})`,
    );
  }
  if (errorKind === "permanent") return { terminal: true };
  if (attemptCount >= config.maxAttempts) return { terminal: true };
  const raw = config.initialDelayMs * config.factor ** (attemptCount - 1);
  const delayMs = Math.min(raw, config.maxDelayMs);
  return { terminal: false, nextAttemptAt: new Date(now.getTime() + delayMs) };
}

export interface ShouldDispatchInput {
  status: EmailOutboxStatus;
  nextAttemptAt: Date | null;
  claimedAt: Date | null;
  now: Date;
}

/**
 * Pure decision: should the worker pick this record up on the
 * current tick? Pending status, no live claim (or claim is stale),
 * `nextAttemptAt` not in the future.
 */
export function shouldDispatchNow(input: ShouldDispatchInput): boolean {
  if (input.status !== "pending") return false;
  if (input.claimedAt && !isStaleClaim(input.claimedAt, input.now)) return false;
  if (input.nextAttemptAt && input.nextAttemptAt.getTime() > input.now.getTime()) return false;
  return true;
}

/**
 * Returns true when a `claimedAt` timestamp is older than the
 * crash-safety threshold — the previous worker probably died before
 * releasing the claim.
 */
export function isStaleClaim(claimedAt: Date | null, now: Date): boolean {
  if (!claimedAt) return false;
  return now.getTime() - claimedAt.getTime() > STALE_CLAIM_THRESHOLD_MS;
}
