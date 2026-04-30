import { spawnSync } from "node:child_process";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

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
 *
 * Migration step: once Better-Auth's Prisma adapter started persisting
 * users / sessions / accounts to Postgres (instead of the previous
 * in-memory storage), e2e tests that hit the auth surface need real
 * tables. We run `prisma migrate deploy` against the testcontainer
 * here so every spec inherits a migrated schema. The migration is
 * idempotent — running it against an existing CI service container
 * is safe.
 */
let container: StartedPostgreSqlContainer | undefined;

export default async function globalSetup(): Promise<() => Promise<void>> {
  process.env.NODE_ENV = "test";

  if (!process.env.DATABASE_URL) {
    container = await new PostgreSqlContainer("postgres:18-alpine")
      .withDatabase("nst_test")
      .withUsername("nst_test")
      .withPassword("nst_test")
      .start();

    process.env.DATABASE_URL = container.getConnectionUri();
  }

  // Apply Prisma migrations to the (just-booted or pre-existing) DB.
  // `migrate deploy` is the production-safe path: forward-only, no
  // reset prompts, no `prisma db push` schema drift.
  //
  // The vanilla `postgres:18-alpine` image testcontainers boots does
  // NOT bundle the `pg_uuidv7` extension — the project's docker-compose
  // image (`docker/postgres/Dockerfile`) bakes it in for prod / local
  // dev, but rebuilding that image for every test run is a 90s tax we
  // avoid by:
  //   1. installing a stub `uuid_generate_v7()` function (shape-compatible
  //      with `pg_uuidv7`'s real implementation; tests exercise the
  //      Better-Auth + Prisma persistence path, not the time-prefix
  //      ordering invariant)
  //   2. resolving the `pg_uuidv7` migration as already-applied so
  //      `migrate deploy` skips its `CREATE EXTENSION` block.
  //
  // External CI service containers can override by exporting
  // `TEST_SKIP_PG_UUIDV7_STUB=1`.
  if (!process.env.TEST_SKIP_PG_UUIDV7_STUB) {
    await ensurePgUuidV7Stub(process.env.DATABASE_URL!);
    const resolve = spawnSync(
      "bunx",
      ["prisma", "migrate", "resolve", "--applied", "20260428000000_pg_uuidv7"],
      { env: { ...process.env }, stdio: "pipe", encoding: "utf8" },
    );
    // `resolve` exits non-zero either when the migration is unknown or
    // already applied — both are benign in a fresh testcontainer that
    // has no `_prisma_migrations` table yet. Capture stderr only so a
    // genuine connection issue still surfaces in the deploy step
    // immediately after.
    if (resolve.status !== 0 && !/already (applied|recorded)/i.test(resolve.stderr ?? "")) {
      // Surface the error but let `migrate deploy` decide if it's fatal.
      // eslint-disable-next-line no-console
      console.error(
        `[global-setup] prisma migrate resolve --applied 20260428000000_pg_uuidv7: ${resolve.stderr ?? ""}`,
      );
    }
  }

  const result = spawnSync("bunx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    throw new Error(`prisma migrate deploy failed (exit ${result.status}):\n${detail}`);
  }

  process.env.TEST_INFRA_READY = "1";

  return async () => {
    delete process.env.TEST_INFRA_READY;
    if (container) {
      await container.stop();
      container = undefined;
    }
  };
}

/**
 * Pre-create a stub `uuid_generate_v7()` so the `20260428000000_pg_uuidv7`
 * migration's payload (`CREATE EXTENSION IF NOT EXISTS pg_uuidv7`) is no
 * longer load-bearing for tests. The function returns a UUID built from
 * `gen_random_uuid()` — the time-prefix ordering invariant of pg_uuidv7
 * is not exercised by any current test. Production / local dev images
 * still bundle the real extension, so this stub never runs there.
 */
async function ensurePgUuidV7Stub(databaseUrl: string): Promise<void> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql VOLATILE",
    );
  } finally {
    await client.end();
  }
}
