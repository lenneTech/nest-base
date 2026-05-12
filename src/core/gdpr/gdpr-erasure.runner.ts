import { Injectable, Logger } from "@nestjs/common";

import { ScheduledJob } from "../jobs/scheduled-job.decorator.js";
import {
  type GraceErasureCandidate,
  type PendingErasureRecord,
  planGdprGracePeriodErasures,
} from "./gdpr-grace.planner.js";

/**
 * `GdprErasureRunner` — daily cron that executes pending GDPR
 * erasures whose 30-day grace window has elapsed (CF.GDPR.04).
 *
 * The runner takes its inputs through closure injection so the
 * scheduled-job harness tests the cron tick without Postgres + the
 * erasure mechanics. The Module registers a concrete factory that
 * provides a real reader + erasure executor at boot.
 *
 * Default schedule:
 *   - cron: "0 4 * * *"  (04:00 UTC every day — quiet window)
 *   - gracePeriodMs: 30 days
 *
 * Per-record failures are non-fatal: a single user's erasure failure
 * (e.g. Postgres FK violation) doesn't block the batch — the runner
 * logs + carries on, and the next tick re-evaluates because the
 * `completedAt` watermark is still null.
 */
export interface GdprErasureRunnerInput {
  /** Returns every active pending-erasure record. */
  readPending: () => Promise<readonly PendingErasureRecord[]>;
  /**
   * Executes the actual erasure (hard-delete vs anonymise per project
   * policy). Implementer is responsible for wrapping in a transaction
   * + writing the audit-log row.
   */
  eraseUser: (candidate: GraceErasureCandidate) => Promise<void>;
  /**
   * Persists `completedAt` on the pending-erasure row. Idempotent —
   * the next tick re-reads with the watermark set so the same user
   * isn't erased twice.
   */
  markCompleted: (id: string, atMs: number) => Promise<void>;
  /** Override the grace window. Default 30 days. */
  gracePeriodMs?: number;
  /** Injectable clock for deterministic tests. */
  clock?: () => number;
}

const DAILY_CRON = "0 4 * * *";

@Injectable()
export class GdprErasureRunner {
  private readonly log = new Logger("GdprErasureRunner");

  constructor(private readonly input: GdprErasureRunnerInput) {}

  /**
   * Daily tick — `DiscoveryScheduledJobRegistry` discovers this method
   * via `@ScheduledJob` metadata; `ScheduledJobBullMQAdapter` wires it
   * to BullMQ at `OnApplicationBootstrap`.
   */
  @ScheduledJob({ name: "gdprErasure", cron: DAILY_CRON })
  async tick(): Promise<{ erased: number; stillInGrace: number; skipped: number }> {
    const pending = await this.input.readPending();
    const plan = planGdprGracePeriodErasures({
      pending,
      ...(this.input.gracePeriodMs !== undefined
        ? { gracePeriodMs: this.input.gracePeriodMs }
        : {}),
      ...(this.input.clock ? { clock: this.input.clock } : {}),
    });

    const now = (this.input.clock ?? Date.now)();
    let erased = 0;
    for (const candidate of plan.readyForErasure) {
      try {
        await this.input.eraseUser(candidate);
        await this.input.markCompleted(candidate.id, now);
        erased++;
      } catch (err) {
        this.log.error(
          `gdprErasure: erase failed for userId=${candidate.userId} (record id=${candidate.id}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    if (erased > 0) {
      this.log.log(`gdprErasure: erased ${erased} user(s) past their 30-day grace window`);
    }
    return {
      erased,
      stillInGrace: plan.stillInGrace.length,
      skipped: plan.skipped.length,
    };
  }
}
