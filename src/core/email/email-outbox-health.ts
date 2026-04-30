/**
 * Email-Outbox health helper.
 *
 * Pure classifier — readiness probe (or any caller) feeds in the
 * current pending count + oldest-pending-age and gets back an
 * ok/fail verdict. The threshold is the issue-#11 acceptance
 * criterion: if the worker hasn't drained the outbox for >30s, the
 * load-balancer should drain this instance so the stalled outbox
 * doesn't hold up downstream verification flows.
 */

export const EMAIL_OUTBOX_LAG_THRESHOLD_MS = 30_000;

export interface EmailOutboxHealthInput {
  pendingCount: number;
  oldestAgeMs: number;
  /** Optional override; defaults to EMAIL_OUTBOX_LAG_THRESHOLD_MS. */
  thresholdMs?: number;
}

export interface EmailOutboxHealthResult {
  status: "ok" | "fail";
  pendingCount: number;
  lagMs: number;
  thresholdMs: number;
  error?: string;
}

export function classifyEmailOutboxLag(input: EmailOutboxHealthInput): EmailOutboxHealthResult {
  const thresholdMs = input.thresholdMs ?? EMAIL_OUTBOX_LAG_THRESHOLD_MS;
  if (input.pendingCount === 0) {
    return { status: "ok", pendingCount: 0, lagMs: 0, thresholdMs };
  }
  if (input.oldestAgeMs > thresholdMs) {
    return {
      status: "fail",
      pendingCount: input.pendingCount,
      lagMs: input.oldestAgeMs,
      thresholdMs,
      error: `email-outbox lag (${input.oldestAgeMs}ms) exceeds threshold (${thresholdMs}ms)`,
    };
  }
  return {
    status: "ok",
    pendingCount: input.pendingCount,
    lagMs: input.oldestAgeMs,
    thresholdMs,
  };
}
