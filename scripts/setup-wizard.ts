#!/usr/bin/env bun
/**
 * `bun run setup` — generate a `.env` from `.env.example`, substituting
 * placeholders with cryptographically random secrets. Idempotent: if
 * `.env` already exists the runner refuses to overwrite it.
 *
 * Pure logic lives in src/core/setup/setup-wizard-runner.ts; this file
 * is just the thin CLI surface (cwd + stdout logging + exit code).
 */

import { findFreePort } from '../src/core/setup/find-free-port.js';
import { runSetupWizard } from '../src/core/setup/setup-wizard-runner.js';

// Pick a free Postgres host-port at setup time so two `--next`
// workspaces on the same machine never collide on `5432:5432`. The
// wizard bakes the chosen port into both `POSTGRES_HOST_PORT` and
// `DATABASE_URL` so the dev server, the Compose stack, and Prisma all
// see the same number.
const postgresHostPort = await findFreePort(5432);
if (postgresHostPort !== 5432) {
  console.log(
    `[setup] port 5432 is busy — picking ${postgresHostPort} for this workspace's Postgres`,
  );
}

const result = runSetupWizard({
  projectRoot: process.cwd(),
  logger: {
    info: (msg) => console.log(`[setup] ${msg}`),
    warn: (msg) => console.warn(`[setup] ${msg}`),
  },
  postgresHostPort,
});

if (!result.created) {
  process.exit(1);
}

console.log('');
console.log('Next steps:');
console.log('  1. Review and adjust values in .env');
console.log('  2. Start dependencies: docker compose up -d');
console.log('  3. Run migrations:     bun run prisma:migrate');
console.log('  4. Boot the server:    bun run dev');
console.log('');
console.log('Re-running setup after a previous boot? Postgres remembers the old');
console.log("password in its volume — if `bun run prisma:migrate` later fails with");
console.log('P1000 auth error, run `docker compose down -v` first to wipe the');
console.log('volume, then `docker compose up -d` again.');
