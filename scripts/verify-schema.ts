#!/usr/bin/env bun
/**
 * `bun run scripts/verify-schema.ts` — fail-fast probe between
 * `prisma migrate deploy` and `bun run seed`.
 *
 * If `migrate deploy` reports success but the public schema is empty,
 * the friction-log #4 root cause is back: a stale `_prisma_migrations`
 * row tricked Prisma into a no-op migration. Without this probe the
 * failure surfaces inside `seed.ts` as a confusing P2021 — surfacing
 * it here gives the contributor a remediation hint at the exact step
 * that caused the problem.
 *
 * SQL + failure message live in `src/core/setup/db-wipe.ts`
 * (`planSchemaSanityCheck()`).
 */

import { Client } from "pg";

import { planSchemaSanityCheck } from "../src/core/setup/db-wipe.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[verify-schema] DATABASE_URL is not set");
  process.exit(1);
}

const probe = planSchemaSanityCheck();
const client = new Client({ connectionString: url });
try {
  await client.connect();
  const result = await client.query<{ count: number }>(probe.statement);
  // pg returns BIGINT as a string by default, but COUNT(*)::int casts to a JS number.
  const count = Number(result.rows[0]?.count ?? 0);
  if (count === 0) {
    console.error(`[verify-schema] ${probe.failureMessage}`);
    process.exit(1);
  }
  console.log(`[verify-schema] ok — ${count} table(s) present in public.`);
} catch (err) {
  console.error(`[verify-schema] ${(err as Error).message}`);
  process.exit(1);
} finally {
  await client.end();
}
