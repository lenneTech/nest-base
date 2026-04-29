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
import { connect } from 'node:net';
import { resolve } from 'node:path';

import { buildOnboardReport, type OnboardChecklistInput } from '../src/core/dx/onboard.js';
import { parseDatabaseUrlForProbe } from '../src/core/dx/parse-database-url.js';

const REQUIRED_BUN = '1.1.0';
const POSTGRES_PROBE_TIMEOUT_MS = 800;

function readBunVersion(): string | undefined {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  return bun?.version;
}

/**
 * Honest Postgres reachability check: parse DATABASE_URL into
 * (host, port) and TCP-probe with a short timeout. Same pattern as
 * `isPortlessProxyRunning()`. Returns false on parse error, port
 * unreachable, or unsupported scheme — the planner reports BLOCKED
 * with a remediation hint.
 */
async function postgresReachable(): Promise<boolean> {
  const target = parseDatabaseUrlForProbe(process.env.DATABASE_URL);
  if (!target) return false;
  return new Promise((resolveProbe) => {
    const socket = connect({
      host: target.host,
      port: target.port,
      timeout: POSTGRES_PROBE_TIMEOUT_MS,
    });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(ok);
    };
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('timeout', () => finish(false));
  });
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
