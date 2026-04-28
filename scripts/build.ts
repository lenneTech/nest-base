/**
 * Build entry-point.
 *
 * Skips silently if `src/main.ts` does not yet exist — the entry point is
 * created in the "Projekt-Skeleton" slice. Until then `bun run build` is a
 * no-op so CI / quality-gates pass on empty repos.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const entry = resolve(process.cwd(), 'src/main.ts');

if (!existsSync(entry)) {
  console.log('[build] src/main.ts not present yet — skipping bundling.');
  process.exit(0);
}

const result = await Bun.build({
  entrypoints: [entry],
  outdir: resolve(process.cwd(), 'dist'),
  target: 'bun',
  // NestJS pulls in optional integrations (class-transformer, class-validator,
  // platform-fastify, microservice transports, websockets, …) lazily; we use
  // Zod and the Express platform, so the rest stays as runtime-resolved
  // externals to avoid bundle-time resolution errors.
  external: [
    'class-transformer',
    'class-validator',
    '@nestjs/microservices',
    '@nestjs/websockets',
    '@nestjs/platform-fastify',
    '@nestjs/platform-socket.io',
    '@nestjs/platform-ws',
    '@apollo/gateway',
    '@apollo/subgraph',
    '@nestjs/graphql',
    'cache-manager',
  ],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`[build] wrote ${result.outputs.length} artifact(s) to ./dist`);
