/**
 * Pure planners for rate-limit decision sampling (issue #94).
 *
 * Block decisions are always recorded (they are the primary operator
 * signal). Allow decisions are sampled at 1% to keep the
 * `rate_limit_decisions` table from bloating on high-traffic deployments
 * while still providing a representative allow-rate baseline.
 */

export interface RateLimitDecisionRecord {
  bucketKey: string;
  endpoint: string;
  decision: "allow" | "block";
  count: number;
  limit: number;
  windowSecs: number;
  ip?: string;
  userId?: string;
  ts: Date;
}

export interface BuildDecisionRecordInput {
  bucketKey: string;
  endpoint: string;
  decision: "allow" | "block";
  count: number;
  limit: number;
  windowSecs: number;
  ip?: string;
  userId?: string;
}

/**
 * Decide whether to write a decision record.
 *
 * Blocks: always sampled — the operator needs to see every block.
 * Allows: sampled at 1% (Math.random() < 0.01) to limit write volume
 *         on busy deployments while preserving statistical allow-rate data.
 */
export function shouldSampleDecision(decision: "allow" | "block"): boolean {
  if (decision === "block") return true;
  return Math.random() < 0.01;
}

/**
 * Build a `RateLimitDecisionRecord` for persistence. The `ts` field is
 * `new Date()` at call time; callers that need deterministic timestamps
 * (tests) can override via `vi.useFakeTimers()`.
 */
export function buildDecisionRecord(input: BuildDecisionRecordInput): RateLimitDecisionRecord {
  return {
    bucketKey: input.bucketKey,
    endpoint: input.endpoint,
    decision: input.decision,
    count: input.count,
    limit: input.limit,
    windowSecs: input.windowSecs,
    ...(input.ip !== undefined ? { ip: input.ip } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    ts: new Date(),
  };
}
