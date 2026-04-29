/**
 * Webhook retry-policy (PLAN.md §10 + §28.4/#18).
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

export const WEBHOOK_RETRY_DEFAULTS: RetryConfig = {
  initialDelayMs: 1000,
  factor: 2,
  // 1h cap — typical Standard Webhooks recommendation
  maxDelayMs: 60 * 60 * 1000,
  autoDisableAfter: 20,
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
