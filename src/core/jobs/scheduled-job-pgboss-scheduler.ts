import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";

import type { ScheduledJobEntry, ScheduledJobRegistry } from "./scheduled-job.registry.js";

/**
 * pg-boss-driven cron scheduling for the `@ScheduledJob` registry
 * (CF.JOBS.01+02 / Finding 12).
 *
 * Iter-95's `ScheduledJobRegistry` walks every decorated method and
 * exposes a `list()` snapshot. Iter-96's scheduler turns that
 * snapshot into actual cron via pg-boss:
 *   - `boss.start()` — opens the connection pool + creates the
 *     `pgboss.*` schema if missing.
 *   - `boss.work(name, handler)` — registers the handler that runs
 *     when pg-boss claims a job.
 *   - `boss.schedule(name, cron)` — installs the cron that enqueues
 *     a job at the cron time.
 *
 * Lifecycle hooks (Nest):
 *   - `OnApplicationBootstrap` → start + work + schedule.
 *   - `OnModuleDestroy` → stop (drains in-flight work, closes pool).
 *
 * Test-mode: when `boss === null`, every method is a no-op. The
 * `JobsModule` factory passes `null` when `DATABASE_URL` is unset
 * or `FEATURE_JOBS_PG_BOSS=false`. Tests exercise scheduled jobs
 * via `registry.runOnce(name)` directly + don't need a live pg-boss.
 */

export interface PgBossLike {
  start(): Promise<unknown>;
  work(name: string, handler: () => Promise<unknown> | unknown): Promise<unknown>;
  schedule(name: string, cron: string): Promise<unknown>;
  stop(): Promise<unknown>;
}

export interface PgBossScheduledJobsPlanInput {
  readonly entries: readonly ScheduledJobEntry[];
}

export interface PgBossScheduledJobsPlan {
  /** `boss.work(name, handler)` calls — one per registry entry. */
  readonly work: ReadonlyArray<{
    readonly name: string;
    readonly handler: () => Promise<unknown>;
  }>;
  /** `boss.schedule(name, cron)` calls — one per registry entry. */
  readonly schedule: ReadonlyArray<{
    readonly name: string;
    readonly cron: string;
  }>;
}

/**
 * Pure planner — translates a `ScheduledJobEntry[]` snapshot into
 * the boss API calls. Keeps the runner trivially testable (the
 * runner just iterates the plan) and lets test fixtures synthesise
 * a plan without instantiating the runner class.
 */
export function buildPgBossScheduledJobsPlan(
  input: PgBossScheduledJobsPlanInput,
): PgBossScheduledJobsPlan {
  const work: PgBossScheduledJobsPlan["work"] = input.entries.map((entry) => ({
    name: entry.name,
    handler: () => Promise.resolve(entry.run()),
  }));
  const schedule: PgBossScheduledJobsPlan["schedule"] = input.entries.map((entry) => ({
    name: entry.name,
    cron: entry.cron,
  }));
  return { work, schedule };
}

export interface PgBossScheduledJobSchedulerOptions {
  readonly boss: PgBossLike | null;
  readonly registry: ScheduledJobRegistry;
}

@Injectable()
export class PgBossScheduledJobScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("PgBossScheduledJobScheduler");
  private started = false;

  constructor(private readonly options: PgBossScheduledJobSchedulerOptions) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.boss) {
      this.log.log(
        "pg-boss adapter not bound — scheduled jobs run on demand only (set DATABASE_URL + FEATURE_JOBS_PG_BOSS=true to schedule via cron)",
      );
      return;
    }
    await this.options.boss.start();
    this.started = true;

    const plan = buildPgBossScheduledJobsPlan({ entries: this.options.registry.list() });
    for (const w of plan.work) {
      await this.options.boss.work(w.name, w.handler);
    }
    for (const s of plan.schedule) {
      await this.options.boss.schedule(s.name, s.cron);
    }
    this.log.log(`pg-boss scheduled ${plan.schedule.length} job(s) via ScheduledJobRegistry`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.options.boss || !this.started) return;
    await this.options.boss.stop();
    this.started = false;
  }
}
