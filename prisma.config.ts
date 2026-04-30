// Load `.env` BEFORE Prisma reads `datasource.url`. Bun's `bun run`
// auto-populates `process.env` for the parent script, but the Prisma
// CLI is a Node-spawned subprocess that does not inherit Bun's env
// loading — so without this side-effect import, `prisma migrate deploy`
// fails with "Connection url is empty" even though `.env` exists.
//
// Override mode: dotenv's default behaviour leaves existing
// `process.env` values intact. That meant a stale `DATABASE_URL`
// exported in the parent shell silently shadowed the workspace's
// `.env`, sending migrations against the wrong database. `override:
// true` forces the workspace `.env` to win, which is the only correct
// answer for a per-workspace tool — except in tests, where the Vitest
// `globalSetup` deliberately injects a testcontainer URL that must
// not be clobbered by the project's stationary `.env`.
import { config as loadEnv } from 'dotenv';

loadEnv({ override: process.env.NODE_ENV !== 'test' });

import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 config.
 *
 * The connection URL moved out of `schema.prisma` (Prisma 7 breaking
 * change). Migrate / studio / migrate-diff commands need it via
 * `datasource.url`; the runtime `PrismaClient` receives its driver
 * adapter in `PrismaService`.
 *
 * The empty-string fallback keeps `prisma generate` and read-only
 * commands working when `.env` is missing — the DB-touching commands
 * (`migrate deploy`, `migrate reset`, `studio`) fail loudly with the
 * usual P1000 / P1001 error instead of silently bypassing the gate.
 */
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
