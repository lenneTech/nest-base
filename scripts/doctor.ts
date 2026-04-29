#!/usr/bin/env bun
/**
 * `bun run doctor` — comprehensive environment health check.
 *
 * Pure logic in `src/core/dx/doctor.ts`. This file:
 *   - reads the actual env, container statuses, service ports, disk
 *     space, Bun version
 *   - hands them to the planner
 *   - renders the resulting report (terminal or JSON)
 *
 * Usage:
 *   bun run doctor          # terminal table, exit non-zero if blocked
 *   bun run doctor --json   # machine-readable JSON for CI consumption
 */

import { existsSync, statfsSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';

import { type ContainerState, buildDoctorReport } from '../src/core/dx/doctor.js';
import { parseDatabaseUrlForProbe } from '../src/core/dx/parse-database-url.js';

const REQUIRED_BUN = '1.1.0';
const REQUIRED_ENV_KEYS = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'APP_BASE_URL'];

function readBunVersion(): string | undefined {
  const bun = (globalThis as { Bun?: { version: string } }).Bun;
  return bun?.version;
}

function which(bin: string): string | undefined {
  const result = Bun.spawnSync(['which', bin]);
  if (result.exitCode !== 0) return undefined;
  const out = new TextDecoder().decode(result.stdout).trim();
  return out === '' ? undefined : out;
}

function readContainerState(name: string): ContainerState {
  const docker = which('docker');
  if (!docker) return 'unknown';
  const result = Bun.spawnSync([docker, 'inspect', '-f', '{{.State.Running}}', name]);
  if (result.exitCode !== 0) return 'not-running';
  const out = new TextDecoder().decode(result.stdout).trim();
  return out === 'true' ? 'running' : 'not-running';
}

async function probeTcp(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = connect({ host, port, timeout: timeoutMs });
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

const projectRoot = process.cwd();
const projectName = (() => {
  try {
    const pkg = JSON.parse(Bun.file(resolve(projectRoot, 'package.json')).text() as unknown as string) as {
      name?: string;
    };
    return pkg.name ?? 'app';
  } catch {
    return 'app';
  }
})();

// Containers
const containers: Record<string, ContainerState> = {
  postgres: readContainerState(`${projectName}-postgres`),
};

// Service probes
const dbTarget = parseDatabaseUrlForProbe(process.env.DATABASE_URL);
const services: Record<string, boolean> = {
  postgres: dbTarget ? await probeTcp(dbTarget.host, dbTarget.port) : false,
};

// Disk space (cwd's filesystem)
let diskFreeBytes = Number.MAX_SAFE_INTEGER;
try {
  const stats = statfsSync(projectRoot);
  diskFreeBytes = stats.bavail * stats.bsize;
} catch {
  // best effort
}

const env: Record<string, string | undefined> = {};
for (const key of REQUIRED_ENV_KEYS) env[key] = process.env[key];

const report = buildDoctorReport({
  bunVersion: readBunVersion(),
  requiredBunVersion: REQUIRED_BUN,
  envFileExists: existsSync(resolve(projectRoot, '.env')),
  env,
  requiredEnvKeys: REQUIRED_ENV_KEYS,
  containers,
  services,
  diskFreeBytes,
});

const wantsJson = process.argv.includes('--json');
if (wantsJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log('Doctor report');
  console.log('=============');
  for (const step of report.steps) {
    const icon = step.status === 'ok' ? 'OK  ' : step.status === 'warning' ? 'WARN' : 'FAIL';
    console.log(`  [${icon}] ${step.label}`);
    if (step.detail) console.log(`         ${step.detail}`);
    if (step.remediation) console.log(`         → ${step.remediation}`);
  }
  console.log('');
  console.log(`Summary: ${report.summary.ok} ok, ${report.summary.warning} warning, ${report.summary.blocked} blocked`);
}

if (!report.ok) process.exit(1);
