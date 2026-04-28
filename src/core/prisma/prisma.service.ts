import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 7 client wrapped as a NestJS provider.
 *
 * Prisma 7 moved the connection URL out of `schema.prisma` and now requires
 * a driver adapter. We use `@prisma/adapter-pg` — the URL comes from
 * `DATABASE_URL`, which testcontainers sets in tests and ENV-validation
 * (later slice) sets in prod.
 *
 * Connection lifecycle:
 *   - `onModuleInit` opens the pool on app boot (so DB errors fail-fast).
 *   - `onModuleDestroy` flushes + disconnects on shutdown.
 *
 * Migrations are NOT run from the application — they are managed via
 * `bun run prisma:migrate` in CI / dev.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is required to construct PrismaService');
    }
    super({ adapter: new PrismaPg({ connectionString: url }) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
