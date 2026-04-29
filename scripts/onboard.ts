#!/usr/bin/env bun
/**
 * `bun run onboard` — first-run checklist for a fresh contributor.
 *
 * Pure logic lives in `src/core/dx/onboard.ts`; this file does the
 * I/O: collect Bun version, check `.env` presence, ping Postgres,
 * verify Prisma client + migrations. The planner produces a
 * structured report; we render it to the terminal.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildOnboardReport, type OnboardChecklistInput } from '../src/core/dx/onboard.js';

const REQUIRED_BUN = '1.1.0';

function readBunVersion(): string | undefined {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  return bun?.version;
}

async function postgresReachable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  // Just parse — no DB ping (would require pg in deps; the contributor
  // can run `docker compose ps` for an authoritative check).
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function prismaClientGenerated(): boolean {
  const root = process.cwd();
  return existsSync(resolve(root, 'node_modules/.prisma/client'));
}

function migrationsUpToDate(): boolean {
  // Heuristic only — `prisma migrate status` requires a live DB. A
  // fresh checkout's migrations directory contains everything the
  // template ships, so presence is the cheap signal.
  return existsSync(resolve(process.cwd(), 'prisma/migrations'));
}

const input: OnboardChecklistInput = {
  bunVersion: readBunVersion(),
  requiredBunVersion: REQUIRED_BUN,
  envFileExists: existsSync(resolve(process.cwd(), '.env')),
  postgresReachable: await postgresReachable(),
  prismaClientGenerated: prismaClientGenerated(),
  migrationsUpToDate: migrationsUpToDate(),
};

const report = buildOnboardReport(input);
const blocked = report.steps.filter((s) => s.status === 'blocked');

console.log('Onboarding checklist');
console.log('====================');
for (const step of report.steps) {
  const icon = step.status === 'ok' ? 'OK' : step.status === 'warning' ? 'WARN' : 'BLOCK';
  console.log(`  [${icon}] ${step.label}`);
  if (step.detail) console.log(`         ${step.detail}`);
  if (step.remediation) console.log(`         → ${step.remediation}`);
}
console.log('');

if (blocked.length > 0) {
  console.log(`${blocked.length} blocking issue(s) — fix the above before running \`bun run dev\`.`);
  process.exit(1);
}
console.log('Onboarding ready. Next: `docker compose up -d && bun run dev`.');
