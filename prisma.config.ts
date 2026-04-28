import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 config.
 *
 * The connection URL has moved out of `schema.prisma` (Prisma 7 breaking
 * change). Migrate / studio commands read `DATABASE_URL` from env, the
 * runtime `PrismaClient` receives its driver adapter in `PrismaService`.
 */
export default defineConfig({
  schema: './prisma/schema.prisma',
});
