import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Client } from "pg";

import {
  type EnsurePrismaClientPlan,
  planEnsurePrismaClient,
} from "../src/core/testing/ensure-prisma-client.js";
import { pinTestNodeEnv } from "../src/core/testing/pin-test-node-env.js";
import { planTestDatabaseStrategy } from "../src/core/testing/test-database-strategy.js";

/**
 * Vitest globalSetup hook.
 *
 * Bootstraps a Postgres test container for the entire test run and exposes
 * its connection URL via `DATABASE_URL`.
 *
 * Database strategy is decided by `planTestDatabaseStrategy()` (pure
 * planner), not by branching on the inherited env directly. The default
 * is **always testcontainer** — even when `DATABASE_URL` is already in
 * `process.env`. Bun auto-loads `.env`, so a fresh consumer's dev URL
 * would otherwise leak into the test runner and silently turn
 * `bun run test:e2e` into "drop my dev DB". Two explicit overrides
 * exist:
 *   - `TEST_DATABASE_URL=<url>`  → CI service container (no opt-in needed).
 *   - `TEST_REUSE_DEV_DB=1`      → reuse the inherited DATABASE_URL
 *                                   (DESTRUCTIVE — tests will write to
 *                                   and drop rows from the dev DB).
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
  // Belt-and-braces NODE_ENV pin. The per-worker `setupFiles` hook
  // (pin-node-env.ts) is the load-bearing version; pinning here too
  // covers the main Vitest process where globalSetup itself runs.
  pinTestNodeEnv(process.env);

  const plan = planTestDatabaseStrategy({ env: process.env });
  // eslint-disable-next-line no-console
  console.log(`[global-setup] database strategy: ${plan.reason}`);
  if (plan.warning) {
    // eslint-disable-next-line no-console
    console.warn(`[global-setup] WARNING: ${plan.warning}`);
  }

  if (plan.strategy === "reuse-existing" && plan.useUrl) {
    process.env.DATABASE_URL = plan.useUrl;
  } else {
    // Spawn-container path. Clear any inherited URL so the runner's
    // testcontainer URL is the only one that lands in process.env —
    // otherwise a stale dev URL could survive the assignment if the
    // testcontainer assignment races with a parallel module read.
    if (plan.clearDatabaseUrl) {
      delete process.env.DATABASE_URL;
    }

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
  // dev. The init migration's CREATE EXTENSION is wrapped in a DO block
  // that silently no-ops when the binary is absent. We still install a
  // stub `uuid_generate_v7()` function so column defaults work correctly.
  //
  // External CI service containers can override by exporting
  // `TEST_SKIP_PG_UUIDV7_STUB=1`.
  // On vanilla postgres:18-alpine (testcontainers) pg_uuidv7 is not
  // available. The init migration wraps CREATE EXTENSION in a DO block
  // that silently skips it when the binary is absent. We still need the
  // uuid_generate_v7() function itself — install the shape-compatible stub
  // so column defaults like `@default(dbgenerated("uuid_generate_v7()"))` work.
  if (!process.env.TEST_SKIP_PG_UUIDV7_STUB) {
    await ensurePgUuidV7Stub(process.env.DATABASE_URL!);
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

  // Ensure the Prisma client is generated. A pristine `lt fullstack
  // init --next` workspace runs `bun install → … → bun run prisma:migrate`
  // without ever invoking `prisma generate`, so the very first
  // `bun run test:e2e` fails with `Cannot find module '.prisma/client/default'`
  // when worker forks try to import `@prisma/client`. The pure planner
  // is in `src/core/testing/ensure-prisma-client.ts`; this runner
  // executes its `generate` plan via `bunx prisma generate`.
  // Idempotent: a re-run with the client already present is a `skip`.
  ensurePrismaClientGenerated();

  // Ensure the Dev-Portal SPA bundle is present before any dev-hub e2e
  // spec runs. Fresh clones don't have `dist/dev-portal/` yet, and the
  // `/dev/static/*` controller is wired straight to that directory — so
  // `tests/dev-hub.e2e-spec.ts` would 404 unless someone remembered to
  // run `bun run build:dev-portal` first. The build is a no-op if the
  // entry artefact already exists; a fresh install pays the ~1s tax once.
  ensureDevPortalBundle();

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
 * Run `prisma generate` on demand if the package-local Prisma client
 * is missing. Closes the friction-log gap where a fresh
 * `lt fullstack init --next` workspace's first `bun run test:e2e`
 * fails with `Cannot find module '.prisma/client/default'` because no
 * documented setup step generates the client.
 *
 * The decision (run vs skip) is delegated to `planEnsurePrismaClient`
 * — this runner is just a `spawnSync` shim so the planner stays pure
 * and unit-testable.
 *
 * Failure modes:
 *   - `bunx`/`prisma` missing → spawnSync returns a non-zero status;
 *     we surface stdout+stderr in the thrown error so the operator
 *     can fix their toolchain.
 *   - schema-not-found inside the subprocess → also non-zero status;
 *     same surfacing path.
 */
function ensurePrismaClientGenerated(): void {
  const repoRoot = process.cwd();
  const layout = {
    packageRoot: repoRoot,
    packagePrismaClientDefaultExists: existsSync(
      resolve(repoRoot, "node_modules/.prisma/client/default.js"),
    ),
    schemaExists: existsSync(resolve(repoRoot, "prisma/schema.prisma")),
  };
  const plan: EnsurePrismaClientPlan = planEnsurePrismaClient(layout);
  if (plan.kind === "skip") return;

  const result = spawnSync(plan.command, [...plan.args], {
    cwd: plan.cwd,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    throw new Error(
      `${plan.command} ${plan.args.join(" ")} failed (exit ${result.status}):\n${detail}`,
    );
  }
}

/**
 * Build the Dev-Portal SPA bundle on demand if it is missing. The
 * controller at `/dev/static/*` serves files from `dist/dev-portal/`,
 * which only exists after `bun run build:dev-portal`. The standard
 * 6-gate sequence in QUICKSTART.md / CONTRIBUTING.md does not yet
 * include the build, so fresh installs would fail two dev-hub e2e
 * tests until they ran the build by hand. Running it from globalSetup
 * removes that sharp edge.
 */
function ensureDevPortalBundle(): void {
  const repoRoot = process.cwd();
  const entry = resolve(repoRoot, "dist/dev-portal/main.js");
  const tokens = resolve(repoRoot, "dist/dev-portal/tokens.css");
  if (existsSync(entry) && existsSync(tokens)) return;

  const result = spawnSync("bun", ["run", "build:dev-portal"], {
    stdio: "pipe",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    throw new Error(`build:dev-portal failed (exit ${result.status}):\n${detail}`);
  }
}

/**
 * Pre-create a stub `uuid_generate_v7()` so the init migration's
 * `CREATE EXTENSION IF NOT EXISTS pg_uuidv7` (wrapped in a DO block that
 * silently no-ops when the binary is absent) still leaves the function
 * available for column defaults. The function returns a UUID built from
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
