import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Vitest globalSetup hook.
 *
 * Bootstraps a Postgres test container for the entire test run and exposes its
 * connection URL via `DATABASE_URL`. If a `DATABASE_URL` is already provided
 * (CI service container, dev override), the existing URL is reused and no
 * container is started.
 *
 * Why testcontainers and not docker-compose: testcontainers gives us
 * parallel-safe, run-isolated databases with deterministic cleanup. The
 * docker-compose Postgres in this repo is for the dev workflow only.
 */
let container: StartedPostgreSqlContainer | undefined;

export default async function globalSetup(): Promise<() => Promise<void>> {
  process.env.NODE_ENV = 'test';

  if (!process.env.DATABASE_URL) {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('nst_test')
      .withUsername('nst_test')
      .withPassword('nst_test')
      .start();

    process.env.DATABASE_URL = container.getConnectionUri();
  }

  process.env.TEST_INFRA_READY = '1';

  return async () => {
    delete process.env.TEST_INFRA_READY;
    if (container) {
      await container.stop();
      container = undefined;
    }
  };
}
