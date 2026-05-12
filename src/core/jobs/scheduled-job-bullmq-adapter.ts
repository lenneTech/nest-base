import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";

import { BullMQJobQueue } from "./bullmq-job-queue.js";
import { SCHEDULED_JOB_REGISTRY, type ScheduledJobRegistry } from "./scheduled-job.registry.js";

/**
 * `ScheduledJobBullMQAdapter` — wires every `@ScheduledJob`-decorated
 * method in the app to the `BullMQJobQueue` (via `JobQueueService`) at bootstrap.
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
 *   Redis-backed scheduler process. The `BullMQJobQueue` base class
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
 * Registers `BullMQJobQueue` handler + schedules recurring enqueues
 * via `setInterval`. The FIRST enqueue fires after one full interval
 * (not at boot). Use a dedicated seeding mechanism or a one-shot enqueue
 * call in project bootstrap if you need "run immediately on restart"
 * behaviour (M1 fix — corrects the contradicting "enqueues immediately"
 * claim that appeared in older iterations).
 */
@Injectable()
export class ScheduledJobBullMQAdapter implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("ScheduledJobBullMQAdapter");
  private readonly timers: ReturnType<typeof setInterval>[] = [];

  constructor(
    private readonly queue: BullMQJobQueue,
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

      const parsedIntervalMs = parseCronToIntervalMs(entry.cron);
      if (parsedIntervalMs === null) {
        // Unrecognised cron — fall back to daily so the job still runs but
        // the warning from parseCronToIntervalMs already surfaced the issue.
        this.log.warn(
          `unrecognised cron "${entry.cron}" for job "${entry.name}"; defaulting to 24h interval`,
        );
      }
      const intervalMs = parsedIntervalMs ?? 24 * 60 * 60 * 1000;
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

    this.log.log(
      `wired ${entries.length} scheduled job(s): ${entries.map((e) => e.name).join(", ")}`,
    );
  }

  /**
   * NestJS lifecycle hook — clear all scheduled timers when the module
   * is torn down so the process can exit cleanly and tests don't leak
   * open handles (H1 fix).
   */
  onModuleDestroy(): void {
    this.clearAll();
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
 * Returns `null` for unrecognised patterns so the caller can decide how
 * to handle an unsupported expression (log, skip, or apply a safe default).
 * The caller (onApplicationBootstrap) logs the warning via this.log.warn.
 *
 * **Wall-clock alignment caveat (M1 fix):** This function derives only
 * the period (e.g. `0 * * * *` → 3600 s). The resulting `setInterval`
 * fires after one full period from startup, NOT at the next wall-clock
 * occurrence of the cron expression. For exact wall-clock scheduling
 * (e.g. "always at 04:00 UTC"), replace with BullMQ native repeat
 * patterns (requires direct `Queue` access and a Redis-backed scheduler).
 */
export function parseCronToIntervalMs(cron: string): number | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) {
    return null;
  }

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

  // Unrecognised — return null so the caller (onApplicationBootstrap) can
  // emit a structured log via this.log.warn and apply a safe fallback.
  return null;
}
