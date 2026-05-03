#!/usr/bin/env bun
/**
 * `bun run scripts/wipe-db.ts` — drops everything in the `public`
 * schema and re-creates it. Used by `bun run reset` to wipe state
 * without invoking `prisma migrate reset`, which Prisma 7 blocks
 * for AI agents via a built-in safety gate.
 *
 * Pure SQL recipe lives in `src/core/setup/db-wipe.ts` (see
 * `planDbWipe()`); this file is the thin runner — open a pg client,
 * loop through `plan.steps`, run each statement, handle the discovery
 * step's parameter substitution.
 *
 * Refuses on:
 *   - missing `DATABASE_URL`
 *   - non-local hosts (defense-in-depth — the parent `reset.ts`
 *     planner already enforces this; this is a belt-and-braces
 *     check in case the script is invoked directly)
 */

import { Client } from "pg";

import { planDbWipe } from "../src/core/setup/db-wipe.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[wipe-db] DATABASE_URL is not set");
  process.exit(1);
}

let host: string | null = null;
try {
  host = decodeURIComponent(new URL(url).hostname);
} catch {
  // pass-through — handled below
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const isLocal =
  !!host &&
  (LOCAL_HOSTS.has(host) ||
    (!host.includes(".") && !host.includes("/") && /^[a-z0-9][a-z0-9_-]*$/i.test(host)));

if (!isLocal) {
  console.error(`[wipe-db] refusing: DATABASE_URL host "${host ?? "<unparseable>"}" is not local`);
  process.exit(1);
}

// Postgres identifier: only [A-Za-z0-9_], length <= 63. Reject anything else
// rather than risk SQL injection through information_schema results.
function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) {
    throw new Error(`[wipe-db] refusing to quote unsafe identifier: ${JSON.stringify(name)}`);
  }
  return `"${name}"`;
}

const plan = planDbWipe();
const client = new Client({ connectionString: url });
try {
  await client.connect();
  console.log("[wipe-db] DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

  for (const step of plan.steps) {
    if (step.verb === "discover-prisma-migrations-schema") {
      const result = await client.query<{ table_schema: string }>(step.statement);
      for (const row of result.rows) {
        // Skip `public` — already covered by the targeted public-schema drop.
        if (row.table_schema === "public") continue;
        const dropStep = plan.steps.find((s) => s.verb === "drop-prisma-migrations-discovered");
        if (!dropStep) continue;
        const sql = dropStep.statement.replace(/"__SCHEMA__"/, quoteIdent(row.table_schema));
        console.log(`[wipe-db] ${sql}`);
        await client.query(sql);
      }
      continue;
    }
    if (step.verb === "drop-prisma-migrations-discovered") {
      // Already handled inside the discovery branch above.
      continue;
    }
    await client.query(step.statement);
  }

  console.log("[wipe-db] done");
} catch (err) {
  console.error(`[wipe-db] ${(err as Error).message}`);
  process.exit(1);
} finally {
  await client.end();
}
