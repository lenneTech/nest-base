#!/usr/bin/env bun
/**
 * `bun run reset` — wipe DB + migrate + seed in one shot.
 *
 * Pure logic (safety gates, step order) lives in
 * `src/core/setup/db-reset.ts`. This file is the thin runner: gather
 * env + filesystem signals, hand them to the planner, execute the
 * resulting steps via Bun.spawn.
 *
 * Refuses on production, missing DATABASE_URL, or non-local host —
 * see the planner for the policy.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { planDbReset } from '../src/core/setup/db-reset.js';

const projectRoot = process.cwd();
const hasFeatureSchemas = existsSync(resolve(projectRoot, 'prisma/features'));
const seedScript = existsSync(resolve(projectRoot, 'scripts/seed.ts'));

const plan = planDbReset({
  env: { ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}) },
  nodeEnv: process.env.NODE_ENV ?? 'development',
  hasFeatureSchemas,
  seedScript,
});

if (!plan.allowed) {
  console.error(`[reset] ${plan.refusalReason}`);
  process.exit(1);
}

console.log('[reset] plan:');
for (const step of plan.steps) {
  console.log(`  - ${step.verb}: ${step.description}`);
}
console.log('');

for (const step of plan.steps) {
  console.log(`[reset] ${step.verb}: ${step.command} ${step.args.join(' ')}`);
  const proc = Bun.spawn([step.command, ...step.args], {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, ...step.env },
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`[reset] step "${step.verb}" failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

console.log('');
console.log('[reset] done. DB wiped, migrated, seeded.');
