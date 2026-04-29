/**
 * Dev runner: starts the API in `bun --watch` mode, wrapping it with
 * portless (when available) so the server is reachable under
 * `https://api.<project>.localhost` with auto-HTTPS.
 *
 * portless 0.11+ replaced its YAML-config model with `portless run
 * --name <name> -- <cmd>`. The portless proxy must already be running
 * — start it once per session via `portless proxy start` (sudo).
 *
 * Fallback path: when portless is not on PATH (or `DISABLE_PORTLESS=1`
 * is set), the API binds to a dynamically assigned port so devs without
 * portless are not blocked.
 *
 * `.env` is watched too: when it changes (e.g. via /dev/features
 * toggle) the child process is re-spawned from scratch so the new
 * process picks up the updated env. `bun --watch` alone only reloads
 * source — env-vars are read once at process start.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, watch } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPortlessRunCommand,
  isPortlessProxyRunning,
  resolveDevPort,
  shouldUsePortless,
} from '../src/core/dev/portless.js';

function which(bin: string): string | undefined {
  const result = Bun.spawnSync(['which', bin]);
  if (result.exitCode !== 0) return undefined;
  const out = new TextDecoder().decode(result.stdout).trim();
  return out === '' ? undefined : out;
}

function readProjectName(): string {
  const pkgPath = resolve(process.cwd(), 'package.json');
  if (!existsSync(pkgPath)) return 'app';
  const match = /"name"\s*:\s*"([^"]+)"/.exec(readFileSync(pkgPath, 'utf8'));
  return match?.[1] ?? 'app';
}

const portlessPath = which('portless');
const useDisable = process.env.DISABLE_PORTLESS === '1';
const usePortless = shouldUsePortless({ portlessPath, disable: useDisable });
const projectName = readProjectName();
const proxyAlive = usePortless ? await isPortlessProxyRunning() : false;

// Boot Postgres via docker compose if it's not already up. Skip when
// SKIP_DB_BOOT=1 (CI passes its own DATABASE_URL via testcontainers,
// or you've already started the stack manually). Also skip when
// docker isn't on PATH — print a hint instead so the user knows the
// API will likely fail at the next /health/ready probe.
if (process.env.SKIP_DB_BOOT !== '1') {
  const dockerPath = which('docker');
  if (dockerPath) {
    const inspect = Bun.spawnSync([dockerPath, 'inspect', '-f', '{{.State.Running}}', `${projectName}-postgres`]);
    const running = new TextDecoder().decode(inspect.stdout).trim() === 'true';
    if (!running) {
      console.log('[dev] starting Postgres via docker compose…');
      const up = Bun.spawnSync([dockerPath, 'compose', 'up', '-d', 'postgres'], {
        stdio: ['inherit', 'inherit', 'inherit'],
      });
      if (up.exitCode !== 0) {
        console.log('[dev] (Postgres start failed — check `docker compose ps` and your .env)');
      }
    }
  } else {
    console.log('[dev] docker not on PATH — start Postgres manually before /health/ready will succeed.');
    console.log('[dev] (set SKIP_DB_BOOT=1 to silence this hint)');
  }
}

interface SpawnPlan {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

// First spawn opens the Dev Hub in the browser; respawns (env-file
// changes, watch-restarts) keep the user's existing tab and let the
// page reload itself.
let isFirstSpawn = true;

function buildSpawnPlan(): SpawnPlan {
  const browserEnv: NodeJS.ProcessEnv = isFirstSpawn ? {} : { DEV_HUB_OPENED: '1' };
  if (usePortless && proxyAlive) {
    const args = buildPortlessRunCommand({
      projectName,
      app: 'api',
      target: ['bun', '--watch', 'src/main.ts'],
    });
    return {
      command: portlessPath!,
      args,
      env: { ...process.env, ...browserEnv, PORTLESS_ACTIVE: '1' },
    };
  }
  const port = resolveDevPort({
    env: process.env as { PORT?: string },
    portlessAvailable: false,
  });
  return {
    command: 'bun',
    args: ['--watch', 'src/main.ts'],
    env: { ...process.env, ...browserEnv, PORT: String(port) },
  };
}

if (usePortless && proxyAlive) {
  console.log(`[dev] portless detected — running through proxy as api.${projectName}.localhost`);
} else if (usePortless && !proxyAlive) {
  console.log(
    '[dev] portless found on PATH but proxy is not running — falling back to direct localhost binding.',
  );
  console.log('[dev] (run `portless proxy start` once to enable the https://api.<project>.localhost route)');
}

let child: ChildProcess | undefined;
let respawning = false;
let shuttingDown = false;

function spawnChild(): ChildProcess {
  const plan = buildSpawnPlan();
  const proc = spawn(plan.command, plan.args, { stdio: 'inherit', env: plan.env });
  isFirstSpawn = false;
  proc.on('exit', (code) => {
    // Don't propagate exit during a planned respawn — a new child is coming.
    if (respawning) return;
    if (shuttingDown) {
      process.exit(code ?? 0);
    }
    process.exit(code ?? 0);
  });
  return proc;
}

child = spawnChild();

// Watch .env so feature toggles in /dev/features force a full process
// restart (not just a `bun --watch` reload, which keeps the cached env).
const envPath = resolve(process.cwd(), '.env');
let respawnTimer: ReturnType<typeof setTimeout> | undefined;
try {
  watch(envPath, { persistent: false }, () => {
    if (shuttingDown) return;
    // Debounce: editors often emit several events per save.
    if (respawnTimer) clearTimeout(respawnTimer);
    respawnTimer = setTimeout(() => {
      if (!child || shuttingDown) return;
      console.log('[dev] .env changed — restarting API to pick up new env-vars');
      respawning = true;
      const old = child;
      old.once('exit', () => {
        respawning = false;
        if (!shuttingDown) child = spawnChild();
      });
      old.kill('SIGTERM');
    }, 200);
  });
} catch {
  /* .env may not exist yet — toggling will create it and the next start picks it up */
}

const shutdown = (signal: NodeJS.Signals): void => {
  shuttingDown = true;
  if (child) child.kill(signal);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
