#!/usr/bin/env bun
/**
 * `bun run add:module <name>` — scaffold a new tenant-scoped resource
 * under `src/modules/`, mirroring `src/modules/example/`.
 *
 * Friction-log run 2026-05-03-14-19-34 entry 14:30: the slash command +
 * `module-scaffolder` agent are documented, but a fresh agent without
 * those tools resolved had to copy `example/` by hand. This script is
 * the shell-callable equivalent.
 *
 * Pure logic — file paths, contents, name validation, idempotency —
 * lives in src/core/dx/scaffold-module-planner.ts. This file is just
 * the thin I/O wrapper: read existing modules, write the planned
 * files, run `bun run prepare:schema`, print the next-steps.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  planScaffoldModule,
  type ScaffoldPlan,
} from '../src/core/dx/scaffold-module-planner.js';

const args = process.argv.slice(2);
const name = args[0];

if (!name) {
  console.error('Usage: bun run add:module <name>');
  console.error('');
  console.error("Example: bun run add:module todo");
  console.error('');
  console.error('The <name> must be lowercase kebab-case (todo, audit-log, ...)');
  process.exit(2);
}

const projectRoot = process.cwd();
const modulesDir = join(projectRoot, 'src/modules');
const existingResources = listExistingResources(modulesDir);

let plan: ScaffoldPlan;
try {
  plan = planScaffoldModule({ name, existingResources });
} catch (err) {
  console.error(`[add:module] ${(err as Error).message}`);
  process.exit(2);
}

if (plan.action === 'abort') {
  console.error(`[add:module] ${plan.reason}`);
  process.exit(1);
}

// Write planned files. Defense in depth: refuse to clobber any file
// that exists on disk even if the planner thought the resource was
// new — protects against a partial previous run that left behind one
// or two files but no full module folder.
for (const file of plan.files) {
  const abs = join(projectRoot, file.path);
  if (existsSync(abs)) {
    console.error(`[add:module] refusing to overwrite ${file.path} — remove it first`);
    process.exit(1);
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, file.content, 'utf8');
  console.log(`[add:module] wrote ${file.path}`);
}

// Re-concat feature schemas so a subsequent `bun run prisma:generate`
// sees the latest combined schema. We deliberately do NOT call
// `prisma migrate dev` — that's destructive and the operator must
// own the migration name + RLS policy authoring (see next-steps).
const prepare = spawnSync('bun', ['run', 'prepare:schema'], {
  cwd: projectRoot,
  stdio: 'inherit',
});
if (prepare.status !== 0) {
  console.warn('[add:module] `bun run prepare:schema` returned a non-zero exit code; rerun manually');
}

console.log('');
console.log(plan.nextSteps);

function listExistingResources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((entry) => {
    try {
      return statSync(join(dir, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}
