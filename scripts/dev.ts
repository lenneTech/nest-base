/**
 * Dev runner: starts the API in `bun --watch` mode, plus portless when
 * available so each service is reachable under
 * `<service>.<project>.localhost` with auto-HTTPS (PLAN.md §28.10/#30).
 *
 * Fallback path: when portless is not on PATH (or `DISABLE_PORTLESS=1`
 * is set), the API binds to a dynamically assigned port so devs without
 * portless are not blocked.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { resolveDevPort, shouldUsePortless } from '../src/core/dev/portless.js';

function which(bin: string): string | undefined {
  const result = Bun.spawnSync(['which', bin]);
  if (result.exitCode !== 0) return undefined;
  const out = new TextDecoder().decode(result.stdout).trim();
  return out === '' ? undefined : out;
}

const portlessPath = which('portless');
const useDisable = process.env.DISABLE_PORTLESS === '1';
const usePortless = shouldUsePortless({ portlessPath, disable: useDisable });
const port = resolveDevPort({ env: process.env as { PORT?: string }, portlessAvailable: usePortless });

const children: ReturnType<typeof spawn>[] = [];

if (usePortless) {
  console.log('[dev] portless detected — booting reverse-proxy daemon');
  const portlessProc = spawn(portlessPath!, ['--config', resolve(process.cwd(), 'portless.yml')], {
    stdio: 'inherit',
    env: process.env,
  });
  children.push(portlessProc);
} else {
  console.log('[dev] portless not available — binding the API to a dynamic port');
}

const apiProc = spawn('bun', ['--watch', 'src/main.ts'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port) },
});
children.push(apiProc);

const shutdown = (signal: NodeJS.Signals): void => {
  for (const child of children) child.kill(signal);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

apiProc.on('exit', (code) => {
  shutdown('SIGTERM');
  process.exit(code ?? 0);
});
