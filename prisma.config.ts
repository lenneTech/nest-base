import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 config.
 *
 * The connection URL moved out of `schema.prisma` (Prisma 7 breaking
 * change). Migrate / studio / migrate-diff commands need it via
 * `datasource.url`; the runtime `PrismaClient` receives its driver
 * adapter in `PrismaService`.
 *
 * `process.env.DATABASE_URL` is auto-populated from the project's
 * `.env` file by the Prisma CLI before this module loads. The
 * empty-string fallback keeps `prisma generate` and read-only commands
 * working when `.env` is missing — the DB-touching commands (`migrate
 * deploy`, `migrate reset`, `studio`) fail loudly with the usual P1000
 * / P1001 error instead of silently bypassing the gate.
 */
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
