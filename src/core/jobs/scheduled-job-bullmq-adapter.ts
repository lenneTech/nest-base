import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";

import { BullMQJobQueue } from "./bullmq-job-queue.js";
import { parseCronToIntervalMs } from "./cron-interval.js";
import { SCHEDULED_JOB_REGISTRY, type ScheduledJobRegistry } from "./scheduled-job.registry.js";

/**
 * `ScheduledJobBullMQAdapter` — wires every `@ScheduledJob`-decorated
 * method in the app to the `BullMQJobQueue` at bootstrap.
 *
 * When `REDIS_URL` is set, recurring work uses BullMQ native
 * `repeat.pattern` jobs (wall-clock cron, one replica per slot).
 * Without Redis, the in-process fallback uses `setInterval` and
 * `enqueue` with the subset supported by `parseCronToIntervalMs`.
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

      if (this.queue.isRedisBacked()) {
        this.log.log(
          `wiring "${entry.name}" (${entry.source}) cron="${entry.cron}" → BullMQ repeat`,
        );
        void this.queue
          .scheduleRepeat(entry.name, entry.cron, { jobId: `scheduled:${entry.name}` })
          .catch((err: unknown) => {
            this.log.error(
              `failed to schedule BullMQ repeat for "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        continue;
      }

      const parsedIntervalMs = parseCronToIntervalMs(entry.cron);
      if (parsedIntervalMs === null) {
        throw new Error(
          `ScheduledJobAdapter: unsupported cron expression "${entry.cron}" for job "${entry.name}" — ` +
            `only hourly ("0 * * * *") and daily ("M H * * *") patterns are supported without Redis.`,
        );
      }
      const intervalMs = parsedIntervalMs;
      this.log.log(
        `wiring "${entry.name}" (${entry.source}) cron="${entry.cron}" → interval=${intervalMs}ms (in-process)`,
      );

      const timer = setInterval(() => {
        this.queue.enqueue(entry.name, {}).catch((err: unknown) => {
          this.log.error(
            `failed to enqueue scheduled job "${entry.name}": ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }, intervalMs);

      if (typeof timer.unref === "function") timer.unref();
      this.timers.push(timer);
    }

    this.log.log(
      `wired ${entries.length} scheduled job(s): ${entries.map((e) => e.name).join(", ")}`,
    );
  }

  onModuleDestroy(): void {
    this.clearAll();
  }

  clearAll(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers.length = 0;
  }
}

export { parseCronToIntervalMs } from "./cron-interval.js";
