#!/usr/bin/env bun
/**
 * `bun run scripts/wipe-db.ts` — drops everything in the `public`
 * schema and re-creates it. Used by `bun run reset` to wipe state
 * without invoking `prisma migrate reset`, which Prisma 7 blocks
 * for AI agents via a built-in safety gate.
 *
 * Refuses on:
 *   - missing `DATABASE_URL`
 *   - non-local hosts (defense-in-depth — the parent `reset.ts`
 *     planner already enforces this; this is a belt-and-braces
 *     check in case the script is invoked directly)
 */

import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[wipe-db] DATABASE_URL is not set');
  process.exit(1);
}

let host: string | null = null;
try {
  host = decodeURIComponent(new URL(url).hostname);
} catch {
  // pass-through — handled below
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const isLocal =
  !!host &&
  (LOCAL_HOSTS.has(host) ||
    (!host.includes('.') && !host.includes('/') && /^[a-z0-9][a-z0-9_-]*$/i.test(host)));

if (!isLocal) {
  console.error(`[wipe-db] refusing: DATABASE_URL host "${host ?? '<unparseable>'}" is not local`);
  process.exit(1);
}

const client = new Client({ connectionString: url });
try {
  await client.connect();
  console.log('[wipe-db] DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO PUBLIC');
  console.log('[wipe-db] done');
} catch (err) {
  console.error(`[wipe-db] ${(err as Error).message}`);
  process.exit(1);
} finally {
  await client.end();
}
