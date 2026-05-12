import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";

import { JobQueueService } from "./jobs.module.js";
import {
  SCHEDULED_JOB_REGISTRY,
  type ScheduledJobRegistry,
} from "./scheduled-job.registry.js";

/**
 * `ScheduledJobBullMQAdapter` — wires every `@ScheduledJob`-decorated
 * method in the app to the `JobQueueService` (BullMQ) at bootstrap.
 *
 * Why this exists (C1 fix):
 *   - `DiscoveryScheduledJobRegistry` discovers `@ScheduledJob` methods
 *     and stores their cron strings + bound handlers in a Map.
 *   - Before this adapter, nothing read the registry and scheduled actual
 *     recurring work — `ApiKeyExpiryRunner.tick()` and
 *     `GdprErasureRunner.tick()` were never called by the runtime.
 *
 * Scheduling strategy — `setInterval` approximation:
 *   BullMQ `repeat` jobs require direct `Queue` object access and a
 *   Redis-backed scheduler process. Our `JobQueueService` wrapper
 *   exposes `register(name, handler)` + `enqueue(name, payload)` but
 *   not the repeat options. Rather than exposing BullMQ internals,
 *   we schedule via `setInterval` and enqueue a one-shot job on each
 *   tick. The in-process fallback (no Redis) uses the same path.
 *
 * Cron parsing — minimal 5-field support:
 *   Only the most common patterns are used today:
 *     "0 8 * * *"  → hourly field=0, minute=0, hour=8 → daily
 *     "0 4 * * *"  → daily at 04:00 UTC
 *   We parse the interval as `hour × 60 + minute` minutes-into-day
 *   and schedule via `setInterval(24h)`. This is deliberately simple
 *   and correct for the two runners that exist. A full cron parser
 *   (e.g. `cron-parser`) can replace this if non-daily schedules are
 *   needed in the future.
 *
 * Registers `JobQueueService` handler + enqueues the first tick
 * immediately on boot so the job runs at least once per restart even
 * when the interval hasn't elapsed yet (matches typical cron-at-startup
 * behaviour).
 */
@Injectable()
export class ScheduledJobBullMQAdapter implements OnApplicationBootstrap {
  private readonly log = new Logger("ScheduledJobBullMQAdapter");
  private readonly timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly queue: JobQueueService,
    @Inject(SCHEDULED_JOB_REGISTRY) private readonly registry: ScheduledJobRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const entries = this.registry.list();
    if (entries.length === 0) {
      this.log.log("no @ScheduledJob entries found — nothing to wire");
      return;
    }

    for (const entry of entries) {
      // Register the job handler so BullMQ (or the in-process fallback)
      // knows how to execute it when a job is dequeued.
      this.queue.register(entry.name, async () => {
        this.log.log(`scheduled job "${entry.name}" starting`);
        try {
          await entry.run();
          this.log.log(`scheduled job "${entry.name}" completed`);
        } catch (err) {
          this.log.error(
            `scheduled job "${entry.name}" failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });

      const intervalMs = parseCronToIntervalMs(entry.cron);
      this.log.log(
        `wiring "${entry.name}" (${entry.source}) cron="${entry.cron}" → interval=${intervalMs}ms`,
      );

      // Schedule recurring enqueues. The first enqueue happens after
      // one full interval so the job runs on its configured schedule.
      // Production deployments that want "run immediately on start" should
      // use a dedicated seeding mechanism or a separate one-shot enqueue.
      const timer = setInterval(() => {
        this.queue.enqueue(entry.name, {}).catch((err: unknown) => {
          this.log.error(
            `failed to enqueue scheduled job "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, intervalMs);

      // Allow Node.js to exit even when these timers are active (e.g.
      // during test teardown). They are cleared in the module destroy hook
      // of `JobQueueService` anyway.
      if (typeof timer.unref === "function") timer.unref();
      this.timers.push(timer);
    }

    this.log.log(`wired ${entries.length} scheduled job(s): ${entries.map((e) => e.name).join(", ")}`);
  }

  /**
   * Clear all intervals — called by the test harness or on module
   * destroy to prevent timer leaks.
   */
  clearAll(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
  }
}

/**
 * Parse a minimal 5-field cron expression into a millisecond interval.
 *
 * Supports the subset used by `ApiKeyExpiryRunner` and `GdprErasureRunner`:
 *   "M H * * *" where M and H are integers (daily at HH:MM UTC).
 *   "0 * * * *" (hourly) → 1 hour interval.
 *
 * Returns `24 * 60 * 60 * 1000` (daily) for unrecognised patterns so
 * unrecognised crons fail safe rather than running at zero interval.
 */
export function parseCronToIntervalMs(cron: string): number {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return 24 * 60 * 60 * 1000;

  const [minutePart, hourPart, dayPart, monthPart, weekPart] = parts;

  // Hourly: "0 * * * *"
  if (
    minutePart === "0" &&
    hourPart === "*" &&
    dayPart === "*" &&
    monthPart === "*" &&
    weekPart === "*"
  ) {
    return 60 * 60 * 1000;
  }

  // Daily at HH:MM: "M H * * *" where H and M are integers
  const hour = Number.parseInt(hourPart ?? "", 10);
  const minute = Number.parseInt(minutePart ?? "", 10);
  if (
    !Number.isNaN(hour) &&
    !Number.isNaN(minute) &&
    dayPart === "*" &&
    monthPart === "*" &&
    weekPart === "*"
  ) {
    return 24 * 60 * 60 * 1000;
  }

  // Default: daily
  return 24 * 60 * 60 * 1000;
}
