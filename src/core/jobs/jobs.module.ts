import { Injectable, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { InMemoryJobQueue } from './job-queue.js';

@Injectable()
export class JobQueueService extends InMemoryJobQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('JobQueueService');

  async onModuleInit(): Promise<void> {
    this.start();
    this.logger.log('job queue started (in-memory adapter)');
  }

  async onModuleDestroy(): Promise<void> {
    this.stop();
    this.logger.log('job queue stopped');
  }
}

/**
 * JobsModule — provides `JobQueueService` (an `InMemoryJobQueue`
 * subclass) with `OnModuleInit`/`OnModuleDestroy` lifecycle hooks.
 * Domain modules `register(name, handler)` from their own
 * `OnModuleInit` and `enqueue(name, payload)` whenever they need to
 * schedule async work.
 *
 * pg-boss-backed adapter swaps in via the `JOB_QUEUE` token once the
 * `pg-boss` schema migration lands.
 */
@Module({
  providers: [JobQueueService],
  exports: [JobQueueService],
})
export class JobsModule {}
