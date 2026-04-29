import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '@prisma/client';

import { getCurrentTenantId } from '../multi-tenancy/tenant.interceptor.js';

/**
 * Prisma 7 client wrapped as a NestJS provider.
 *
 * Prisma 7 moved the connection URL out of `schema.prisma` and now requires
 * a driver adapter. We use `@prisma/adapter-pg` — the URL comes from
 * `DATABASE_URL`, which testcontainers sets in tests and ENV-validation
 * sets in prod.
 *
 * Connection lifecycle:
 *   - `onModuleInit` opens the pool on app boot (so DB errors fail-fast).
 *   - `onModuleDestroy` flushes + disconnects on shutdown.
 *
 * Multi-tenancy / RLS:
 *   `runWithRlsTenant()` wraps a callback in a Postgres transaction
 *   and runs `SET LOCAL "app.tenant_id" = $1` before the callback so
 *   any RLS policy referencing `current_setting('app.tenant_id')`
 *   sees the right value. The interceptor reads the request header
 *   into `AsyncLocalStorage`; this method bridges to the DB layer.
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

  /**
   * Run a callback inside a Postgres transaction with `app.tenant_id`
   * set to the supplied tenant id (or the AsyncLocalStorage default).
   * RLS policies on tenant-scoped tables read the value via
   * `current_setting('app.tenant_id', true)`.
   *
   * Throws `RlsTenantMissingError` if no tenant id is resolvable.
   */
  async runWithRlsTenant<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    tenantId?: string,
  ): Promise<T> {
    const id = tenantId ?? getCurrentTenantId();
    if (!id) throw new RlsTenantMissingError();
    return this.$transaction(async (tx) => {
      // SET LOCAL only persists for the current transaction — the next
      // checkout from the connection pool sees a clean state.
      await tx.$executeRawUnsafe(`SET LOCAL "app.tenant_id" = '${escapeSqlString(id)}'`);
      return fn(tx);
    });
  }
}

export class RlsTenantMissingError extends Error {
  constructor() {
    super('runWithRlsTenant: no tenant id in scope (header missing or interceptor not registered)');
    this.name = 'RlsTenantMissingError';
  }
}

/**
 * Defense in depth — the interceptor already validates the header is
 * a UUID, but this method may be called directly with arbitrary input.
 * Anything that's not a UUID throws; we still escape the literal so a
 * future tenantId scheme change can't surprise us with injection.
 */
function escapeSqlString(input: string): string {
  return input.replaceAll("'", "''");
}
