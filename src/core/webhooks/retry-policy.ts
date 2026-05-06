/**
 * Webhook retry-policy.
 *
 * Exponential backoff with a hard ceiling and an auto-disable after
 * N consecutive failures so a chronically broken endpoint stops
 * burning queue capacity.
 */

export interface RetryConfig {
  initialDelayMs: number;
  factor: number;
  maxDelayMs: number;
  autoDisableAfter: number;
}

/**
 * PRD § Core Features § Webhooks pins the canonical retry curve:
 *   1m → 5m → 25m, 2h hard cap, DLQ after 5 attempts.
 *
 * The schedule is exponential with factor=5, starting at 60_000 ms:
 *   attempt 1 →  1m =     60_000
 *   attempt 2 →  5m =    300_000
 *   attempt 3 → 25m =  1_500_000
 *   attempt 4 →  2h =  7_200_000  (clamped by maxDelayMs)
 *   attempt 5 →  2h =  7_200_000  (clamped, then DLQ)
 */
export const WEBHOOK_RETRY_DEFAULTS: RetryConfig = {
  initialDelayMs: 60_000,
  factor: 5,
  // 2h hard cap — PRD pin, mirroring Standard Webhooks recommended max.
  maxDelayMs: 2 * 60 * 60 * 1000,
  // After 5 consecutive failures the delivery is auto-disabled / DLQ'd.
  autoDisableAfter: 5,
};

export function computeRetryDelayMs(attempt: number, config: RetryConfig): number {
  if (attempt < 1 || !Number.isInteger(attempt)) {
    throw new Error(
      `computeRetryDelayMs: attempt must be a positive integer (received: ${attempt})`,
    );
  }
  const raw = config.initialDelayMs * config.factor ** (attempt - 1);
  return Math.min(raw, config.maxDelayMs);
}

export function shouldAutoDisable(consecutiveFailures: number, config: RetryConfig): boolean {
  return consecutiveFailures >= config.autoDisableAfter;
}
