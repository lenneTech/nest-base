import {
  Inject,
  Injectable,
  Logger,
  Module,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { BullMQJobQueue, type RedisDuplex } from "./bullmq-job-queue.js";
import { DiscoveryScheduledJobRegistry, SCHEDULED_JOB_REGISTRY } from "./scheduled-job.registry.js";
import { ScheduledJobBullMQAdapter } from "./scheduled-job-bullmq-adapter.js";

export const BULLMQ_REDIS = Symbol.for("lt:BullMQRedis");

/**
 * Resolve an ioredis client for BullMQ.
 *
 * Redis is now required — if `REDIS_URL` is not set the module throws
 * at startup with a clear error message. This enforces the
 * BullMQ-only contract (issue #141): there is no in-process fallback
 * for production deployments.
 *
 * Tests that do not set `REDIS_URL` get `null` back so the
 * `BullMQJobQueue` can use its in-process `InProcessQueue` fallback
 * without hitting the guard. The guard only fires at `onModuleInit`
 * time in a real Nest application context.
 */
async function resolveBullMQRedis(): Promise<RedisDuplex | null> {
  const url = process.env.REDIS_URL;
  if (!url) {
    // Return null to allow the module to be created; the guard in
    // `onModuleInit` will throw with a developer-friendly message if
    // this is a production boot (NODE_ENV !== 'test').
    return null;
  }
  try {
    const { default: Redis } = await import("ioredis");
    const client = new Redis(url);
    // Prevent unhandled 'error' event crash on auth failures, network drops,
    // or TLS rejections. ioredis surfaces these via its internal retry logic;
    // commands reject individually instead of crashing the process.
    client.on("error", (err: Error) => {
      process.stderr.write(`[ioredis/BullMQ] connection error: ${err.message}\n`);
    });
    return client as unknown as RedisDuplex;
  } catch {
    return null;
  }
}

/**
 * JobQueueService — BullMQ-only job queue (issue #141).
 *
 * Redis is the sole job store. `REDIS_URL` must be set at startup or
 * `onModuleInit` throws with a clear diagnostic message.
 *
 * The `BullMQJobQueue` base class accepts `null` for `redis` so unit
 * tests that do not set `REDIS_URL` (and therefore skip `onModuleInit`)
 * can instantiate the service directly without a live Redis.
 */
@Injectable()
export class JobQueueService extends BullMQJobQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("JobQueueService");

  constructor(@Optional() @Inject(BULLMQ_REDIS) redis: RedisDuplex | null = null) {
    super(redis);
  }

  async onModuleInit(): Promise<void> {
    // Guard is bypassed inside the Vitest test runner (VITEST env is set
    // by Vitest in every worker) so story/e2e specs that bootstrap the full
    // Nest app without a live Redis still work. In production Redis is
    // mandatory — missing REDIS_URL causes a loud startup failure rather
    // than silent in-memory fallback (issue #141).
    const isTestRunner = Boolean(process.env.VITEST);
    if (!process.env.REDIS_URL && !isTestRunner) {
      throw new Error(
        "REDIS_URL is required — Redis is the job queue store. " +
          "Set it in .env (docker-compose provides Redis on port 6379 by default).",
      );
    }
    await this.start();
    if (process.env.REDIS_URL) {
      this.logger.log("job queue started (BullMQ-backed, Redis store)");
    } else {
      this.logger.log("job queue started (in-process fallback, no REDIS_URL)");
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stop();
    // Close the dedicated BullMQ Redis connection after BullMQ queues/workers
    // have shut down. Without this the ioredis socket keeps the process alive
    // after `app.close()`, preventing clean test teardown and graceful deploys.
    if (this.redis) {
      const status = (this.redis as unknown as { status?: string }).status;
      if (status === "ready" || status === "connect") {
        await (this.redis as unknown as { quit(): Promise<string> })
          .quit()
          .catch(() => (this.redis as unknown as { disconnect(): void }).disconnect());
      }
    }
    this.logger.log("job queue stopped");
  }
}

/**
 * JobsModule — wires `JobQueueService` with lifecycle hooks.
 *
 * Redis is required. The `BULLMQ_REDIS` provider resolves the ioredis
 * client from `REDIS_URL`; if the env var is absent the factory returns
 * `null` and `onModuleInit` throws before the app finishes booting.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [
    JobQueueService,
    DiscoveryScheduledJobRegistry,
    {
      provide: SCHEDULED_JOB_REGISTRY,
      useExisting: DiscoveryScheduledJobRegistry,
    },
    {
      provide: BULLMQ_REDIS,
      useFactory: () => resolveBullMQRedis(),
    },
    // Alias so ScheduledJobBullMQAdapter can inject BullMQJobQueue (its
    // declared constructor param type) without a circular ESM import
    // back to this file. NestJS resolves the alias to the JobQueueService
    // instance which extends BullMQJobQueue.
    { provide: BullMQJobQueue, useExisting: JobQueueService },
    // Wires every @ScheduledJob-decorated method to the BullMQ queue
    // via setInterval-based scheduling at OnApplicationBootstrap (C1 fix).
    ScheduledJobBullMQAdapter,
  ],
  exports: [JobQueueService, SCHEDULED_JOB_REGISTRY, ScheduledJobBullMQAdapter],
})
export class JobsModule {}
