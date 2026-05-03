/**
 * Pure planner for `bun run scripts/wipe-db.ts`.
 *
 * Returns the ordered list of SQL statements the runner sends to the
 * Postgres driver. Splitting the SQL out of the runner gives us a
 * pinnable recipe — story tests assert the order + presence of every
 * statement, so a future regression that re-introduces the
 * "stale `_prisma_migrations`" bug (friction-log run-2026-05-03 #4)
 * is caught at unit-test time rather than after a confusing seed
 * failure.
 *
 * Why the redundant `_prisma_migrations` drops:
 *
 *   1. `DROP SCHEMA public CASCADE` *should* take the table with it,
 *      and in practice it almost always does. We still emit
 *      `DROP TABLE IF EXISTS public._prisma_migrations CASCADE`
 *      defensively — it's free, and it covers the observed case
 *      where the cascade left a stale row behind under Prisma 7
 *      with the driver-adapter.
 *
 *   2. Prisma 7 may store `_prisma_migrations` in a non-`public`
 *      schema when an explicit `?schema=` query parameter is set on
 *      the connection string, or when a migration explicitly creates
 *      the journal somewhere else. The runner runs the discovery
 *      query (returned by this planner) and, if it finds rows, runs
 *      the parameterised DROP for each one.
 *
 * The discovered-schema DROP carries a `__SCHEMA__` placeholder the
 * runner replaces by quoted identifier. Keeping the placeholder in
 * the planner output makes the recipe easy to assert without coupling
 * the test to runtime discovery results.
 */

export type DbWipeVerb =
  | "drop-schema"
  | "create-schema"
  | "grant-schema"
  | "drop-prisma-migrations-public"
  | "discover-prisma-migrations-schema"
  | "drop-prisma-migrations-discovered";

export interface DbWipeStep {
  verb: DbWipeVerb;
  /** SQL statement, no trailing semicolon — pg's simple protocol rejects multi-statement strings. */
  statement: string;
  description: string;
}

export interface DbWipePlan {
  steps: DbWipeStep[];
}

export function planDbWipe(): DbWipePlan {
  const steps: DbWipeStep[] = [
    {
      verb: "drop-schema",
      statement: "DROP SCHEMA IF EXISTS public CASCADE",
      description: "Drop the public schema and every object in it.",
    },
    {
      verb: "create-schema",
      statement: "CREATE SCHEMA public",
      description: "Recreate an empty public schema for migrations to populate.",
    },
    {
      verb: "grant-schema",
      statement: "GRANT ALL ON SCHEMA public TO PUBLIC",
      description: "Restore the default ACL so the migration role can create objects.",
    },
    {
      verb: "drop-prisma-migrations-public",
      statement: "DROP TABLE IF EXISTS public._prisma_migrations CASCADE",
      description:
        "Defense-in-depth: explicitly drop the Prisma journal in case the cascade left a row behind.",
    },
    {
      verb: "discover-prisma-migrations-schema",
      statement:
        "SELECT table_schema FROM information_schema.tables WHERE table_name = '_prisma_migrations'",
      description:
        "Find every schema that still holds a `_prisma_migrations` table (Prisma 7 sometimes places it outside `public`).",
    },
    {
      verb: "drop-prisma-migrations-discovered",
      statement: 'DROP TABLE IF EXISTS "__SCHEMA__"._prisma_migrations CASCADE',
      description:
        "Drop the discovered Prisma journal. Runner substitutes `__SCHEMA__` with each row from the discovery query.",
    },
  ];

  return { steps };
}

/**
 * Probe the post-migrate schema for emptiness. Used by the reset
 * verify step to fail fast when `migrate deploy` succeeded but didn't
 * actually create any tables — the canonical signal of a stale
 * `_prisma_migrations` row.
 */
export interface SchemaSanityProbe {
  /** SQL the runner executes; expects a single row of shape `{ count: bigint | number }`. */
  statement: string;
  /** Message the runner prints (and exits non-zero with) when count === 0. */
  failureMessage: string;
}

export function planSchemaSanityCheck(): SchemaSanityProbe {
  return {
    statement:
      "SELECT COUNT(*)::int AS count FROM information_schema.tables " +
      "WHERE table_schema = 'public' AND table_name !~ '^_prisma_'",
    failureMessage:
      "Migrations reported success but the public schema is empty. " +
      "Likely cause: stale `_prisma_migrations` rows survived the wipe. " +
      "Re-run after manually clearing the table, e.g. " +
      "`psql $DATABASE_URL -c 'DROP TABLE IF EXISTS _prisma_migrations CASCADE'`.",
  };
}
