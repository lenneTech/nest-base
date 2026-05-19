import {
  buildBullMQCleanupJobPlan,
  type CleanupKind,
} from "./bullmq-cleanup-job-planner.js";
import type { BullMQJobQueue } from "./bullmq-job-queue.js";

export interface WireCleanupRepeatResult {
  readonly mode: "bullmq" | "local-interval";
  stop?(): void;
}

/**
 * Wire a cleanup cron to BullMQ native repeat when Redis is available,
 * otherwise fall back to an in-process `setInterval`.
 */
export async function wireBullMQCleanupRepeat(
  queue: BullMQJobQueue | null | undefined,
  kind: CleanupKind,
  handler: () => void | Promise<void>,
  localIntervalMs: number,
): Promise<WireCleanupRepeatResult> {
  if (queue?.isRedisBacked()) {
    const plan = buildBullMQCleanupJobPlan({ kind });
    queue.register(plan.queueName, handler);
    await queue.scheduleRepeat(plan.queueName, plan.repeatPattern, { jobId: plan.jobId });
    return { mode: "bullmq" };
  }

  const timer = setInterval(() => void handler(), localIntervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return {
    mode: "local-interval",
    stop: () => clearInterval(timer),
  };
}
