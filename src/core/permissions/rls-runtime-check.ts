/**
 * Runtime RLS check — thin glue between Postgres + the runtime planner.
 *
 * Why this lives in `src/core/` rather than next to `scripts/`: the
 * e2e test (`tests/check-rls-runtime.e2e-spec.ts`) needs to drive
 * the same code path the CLI uses, against a live testcontainer DB.
 * Shelling out to `bun run check:rls --runtime` from a test would
 * couple the test to the script's argv parsing and exit-code
 * conventions; calling the function directly keeps the test focused
 * on the actual contract: "given a connected pg client, does the
 * planner see the right state?".
 *
 * The planner is pure (`rls-runtime-planner.ts`); this module is the
 * I/O boundary. Anything that reads from Postgres or constructs a
 * client lives here.
 */
import { Client } from "pg";

import {
  type RlsRuntimeFinding,
  type RlsRuntimeModel,
  auditRlsRuntime,
} from "./rls-runtime-planner.js";

/**
 * Minimal pg-client interface we need. Decouples the function from
 * `pg.Client` for fake-injection in tests and lets callers pass a
 * pooled client when one already exists.
 */
export interface PgQueryClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface RuntimeCheckOptions {
  /** Tenant-scoped models, typically from `listTenantScopedModels`. */
  tenantScopedModels: ReadonlyArray<RlsRuntimeModel>;
  /** Already-connected pg client / pool. */
  client: PgQueryClient;
  /** Schema to query — defaults to `public` (the only schema we use). */
  schema?: string;
}

/**
 * Query `pg_class.relrowsecurity` for every regular table in the
 * given schema and feed the result into the pure runtime planner.
 *
 * We deliberately fetch ALL tables in the schema in one round-trip
 * rather than `WHERE relname = ANY($1)` over the model list — the
 * superset is cheap (low dozens of rows in this template), and the
 * "table-missing" finding requires us to know which tables were
 * looked up but absent.
 */
export async function checkRlsAtRuntime(
  options: RuntimeCheckOptions,
): Promise<RlsRuntimeFinding[]> {
  const schema = options.schema ?? "public";
  const result = await options.client.query<{ relname: string; relrowsecurity: boolean }>(
    `SELECT relname, relrowsecurity
       FROM pg_class
       JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_class.relkind = 'r'
        AND pg_namespace.nspname = $1`,
    [schema],
  );
  const dbState: Record<string, boolean> = {};
  for (const row of result.rows) {
    dbState[row.relname] = row.relrowsecurity === true;
  }
  return auditRlsRuntime({
    tenantScopedModels: options.tenantScopedModels,
    dbState,
  });
}

export interface ConnectAndCheckOptions {
  tenantScopedModels: ReadonlyArray<RlsRuntimeModel>;
  /** Postgres connection string (typically `process.env.DATABASE_URL`). */
  databaseUrl: string;
  schema?: string;
}

/**
 * Convenience wrapper for the CLI runner: open a fresh `pg.Client`,
 * run the check, close. The e2e test uses `checkRlsAtRuntime`
 * directly with the existing client to share the testcontainer
 * connection.
 */
export async function connectAndCheckRlsAtRuntime(
  options: ConnectAndCheckOptions,
): Promise<RlsRuntimeFinding[]> {
  const client = new Client({ connectionString: options.databaseUrl });
  await client.connect();
  try {
    return await checkRlsAtRuntime({
      tenantScopedModels: options.tenantScopedModels,
      client,
      schema: options.schema,
    });
  } finally {
    await client.end();
  }
}
