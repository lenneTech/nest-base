#!/usr/bin/env bun
/**
 * `bun run setup` — generate a `.env` from `.env.example`, substituting
 * placeholders with cryptographically random secrets. Idempotent: if
 * `.env` already exists the runner refuses to overwrite it.
 *
 * Pure logic lives in src/core/setup/setup-wizard-runner.ts; this file
 * is just the thin CLI surface (cwd + stdout logging + exit code).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeComposeProjectName } from '../src/core/setup/compose-project-name.js';
import { findFreePort } from '../src/core/setup/find-free-port.js';
import { runSetupWizard } from '../src/core/setup/setup-wizard-runner.js';
import { planVolumeCollisionCheck } from '../src/core/setup/volume-collision-check.js';

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

// Probe for a stale docker volume from a same-named older workspace.
// The friction is that `${COMPOSE_PROJECT_NAME}_postgres_data` keeps
// the *old* POSTGRES_PASSWORD; the freshly written `.env` carries a
// new one, so `bun run prisma:migrate` fails with P1000 and the
// operator chases an opaque auth error. Fail-fast here with the
// recovery commands instead of letting them rediscover the trap.
const composeProjectName = readComposeProjectName(process.cwd()) ?? 'nest-base';
const volumeName = `${composeProjectName}_postgres_data`;
const volumeProbe = spawnSync('docker', ['volume', 'inspect', volumeName], {
  stdio: 'pipe',
  encoding: 'utf8',
});
// `docker volume inspect` exits 0 when the volume exists, non-zero
// otherwise. We treat any non-zero (including "docker not installed"
// → ENOENT) as "no collision", because a host without Docker can't
// have the legacy volume. The runner stays planner-driven so the
// operator-visible message is built from a single source of truth.
//
// Pass `expectedComposeProjectName` so the planner can short-circuit a
// false-positive when the active `COMPOSE_PROJECT_NAME` was set by a
// *different* workspace path (legacy non-hashed name in this `.env`
// pointing at someone else's volume).
const expectedComposeProjectName = readPackageJsonName(process.cwd())
  ? computeComposeProjectName({
      projectName: readPackageJsonName(process.cwd())!,
      workspacePath: process.cwd(),
    })
  : undefined;
const collisionPlan = planVolumeCollisionCheck({
  composeProjectName,
  volumeExists: volumeProbe.status === 0,
  expectedComposeProjectName,
});

if (!collisionPlan.ok) {
  console.error('');
  console.error(collisionPlan.message);
  console.error('');
  console.error('Aborting before `prisma:migrate` would fail with P1000.');
  process.exit(2);
}

console.log('');
console.log('Next steps:');
console.log('  1. Review and adjust values in .env');
console.log('  2. Start dependencies: docker compose up -d');
console.log('  3. Run migrations:     bun run prisma:migrate');
console.log('  4. Boot the server:    bun run dev');

function readComposeProjectName(cwd: string): string | undefined {
  // The wizard just wrote `.env`; read the value back rather than
  // re-parsing `.env.example` so any operator override is honoured.
  const envPath = join(cwd, '.env');
  if (!existsSync(envPath)) return undefined;
  const text = readFileSync(envPath, 'utf8');
  const match = /^COMPOSE_PROJECT_NAME=(.*)$/m.exec(text);
  return match?.[1]?.trim() || undefined;
}

function readPackageJsonName(cwd: string): string | undefined {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return undefined;
  const match = /"name"\s*:\s*"([^"]+)"/.exec(readFileSync(pkgPath, 'utf8'));
  return match?.[1];
}
