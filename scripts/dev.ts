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
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildPortlessRunCommand,
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

let child: ReturnType<typeof spawn>;
if (usePortless) {
  const args = buildPortlessRunCommand({
    projectName,
    app: 'api',
    target: ['bun', '--watch', 'src/main.ts'],
  });
  console.log(`[dev] portless detected — running through proxy as api.${projectName}.localhost`);
  console.log('[dev] (proxy must already be running; start once via `portless proxy start`)');
  child = spawn(portlessPath!, args, {
    stdio: 'inherit',
    env: { ...process.env, PORTLESS_ACTIVE: '1' },
  });
} else {
  const port = resolveDevPort({
    env: process.env as { PORT?: string },
    portlessAvailable: false,
  });
  console.log(`[dev] portless not available — binding the API to port ${port || 'a dynamically assigned'}`);
  child = spawn('bun', ['--watch', 'src/main.ts'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(port) },
  });
}

const shutdown = (signal: NodeJS.Signals): void => {
  child.kill(signal);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
