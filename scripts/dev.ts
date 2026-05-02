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
// Force the workspace `.env` to win over inherited shell env. Bun's
// `bun run` loads `.env` but does NOT override existing `process.env`
// values, which means a stale `DATABASE_URL` / `APP_BASE_URL` /
// `POSTGRES_*` exported from a previous workspace silently leaks
// into the dev server. `override: true` makes the workspace .env
// authoritative, which is the only correct answer per-workspace.
import { config as loadEnv } from 'dotenv';

loadEnv({ override: true });

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  formatMissingCloudflaredHint,
  parseCloudflaredOutput,
  parseTunnelArgs,
  planCloudflaredCommand,
  planTunnelEnvWrite,
} from '../src/core/dev/cloudflare-tunnel.js';
import {
  buildPortlessRunCommand,
  decideRegistrationAction,
  isPortlessProxyRunning,
  resolveDevPort,
  shouldUsePortless,
} from '../src/core/dev/portless.js';
import {
  isPidAlive,
  readPortlessRouteOwner,
} from '../src/core/dev/portless-routes-runner.js';
import {
  clearTunnelState,
  writeTunnelState,
} from '../src/core/dev/tunnel-state-runner.js';
import {
  clearDevSessionState,
  markDevSessionRefresh,
  startDevSession,
} from '../src/core/dx/dev-session-runner.js';

// Start the Dev-Portal SPA build in watch mode alongside the API. Bun
// rebuilds incrementally (~80ms warm) so an edit to `src/core/dx/clients/`
// is reflected on the next browser refresh without a manual rebuild.
//
// IMPORTANT: we await the *initial* build before spawning the API child
// so a request to `/dev/static/main.js` never hits a missing bundle on
// first paint. The watcher then keeps the bundle fresh in the
// background.
const portalEntry = resolve(process.cwd(), 'src/core/dx/clients/main.tsx');
const portalDist = resolve(process.cwd(), 'dist/dev-portal');

let portalWatcher: ChildProcess | undefined;

async function ensureInitialPortalBuild(): Promise<void> {
  if (!existsSync(portalEntry)) return;
  // 1) Run a one-shot, non-watch build that we can `await`. This is
  //    the bundle that the API will serve at `/dev/static/*.js` until
  //    the watcher's first incremental build catches up.
  console.log('[dev] building Dev-Portal SPA (initial)…');
  const built = Bun.spawnSync(['bun', 'run', 'scripts/build-dev-portal.ts'], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  if (built.exitCode !== 0) {
    console.error(
      '[dev] Dev-Portal initial build failed — `/dev/*` will return the SPA shell but the bundle will be missing.',
    );
    return;
  }
  // 2) Now start the watcher to track subsequent edits.
  portalWatcher = spawn('bun', ['run', 'scripts/build-dev-portal.ts', '--watch'], {
    stdio: 'inherit',
  });
}

await ensureInitialPortalBuild();

// Sanity check: the controller serves the bundle from
// `dist/dev-portal/`. If the dir is empty after the build attempt
// (e.g. a previous build left a half-written state), warn loudly so
// the user can spot it before they hit `/dev` and see a blank page.
if (existsSync(portalEntry) && !existsSync(resolve(portalDist, 'main.js'))) {
  console.warn(
    '[dev] Dev-Portal bundle appears missing at',
    portalDist,
    '— `/dev/*` will return the shell but the SPA will not boot.',
  );
}

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

// Persist a session lock that survives `bun --watch` re-execs so the
// Dev Hub opens once per `bun run dev`, not once per file save.
startDevSession(process.cwd());

// Lifted-up state — both the tunnel block and the .env-watch /
// shutdown handlers below read these.
const envPath = resolve(process.cwd(), '.env');
let shuttingDown = false;

// --tunnel flag: spawn `cloudflared` so localhost:<port> is reachable
// from the public internet (webhook receivers etc.). The cloudflared
// child lives in the dev runner — the URL it reports is persisted to
// `node_modules/.cache/nest-base/tunnel.json` so the API child can
// surface it via `/dev/tunnel.json` and the startup banner.
const tunnelArgs = parseTunnelArgs(process.argv.slice(2));
let tunnelChild: ChildProcess | undefined;
let tunnelUrlSeen = false;
if (tunnelArgs.tunnelEnabled) {
  const cloudflaredPath = which('cloudflared');
  if (!cloudflaredPath) {
    console.error(formatMissingCloudflaredHint());
    process.exit(1);
  }
  // Always start with a clean state file so a stale URL from a
  // previous session is never surfaced.
  clearTunnelState(process.cwd());
  const tunnelPort = resolveDevPort({
    env: process.env as { PORT?: string },
    portlessAvailable: usePortless,
  });
  // 0 means "let bun pick a free port at bind time", which we cannot
  // forward through cloudflared. Ask the user to set PORT explicitly
  // in that case rather than racing with the API.
  const cloudflaredTargetPort = tunnelPort > 0 ? tunnelPort : 3000;
  const tunnelCommand = planCloudflaredCommand({
    port: cloudflaredTargetPort,
    ...(process.env.CLOUDFLARE_TUNNEL_NAME
      ? { tunnelName: process.env.CLOUDFLARE_TUNNEL_NAME }
      : {}),
  });
  console.log(
    `[dev] starting Cloudflare-Tunnel: ${tunnelCommand.command} ${tunnelCommand.args.join(' ')}`,
  );
  tunnelChild = spawn(tunnelCommand.command, tunnelCommand.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const onTunnelLine = (line: string): void => {
    const parsed = parseCloudflaredOutput(line);
    if (parsed.url && !tunnelUrlSeen) {
      tunnelUrlSeen = true;
      writeTunnelState(process.cwd(), {
        url: parsed.url,
        startedAt: new Date().toISOString(),
      });
      console.log('');
      console.log(`[dev] ✓ Cloudflare-Tunnel ready: ${parsed.url}`);
      console.log('[dev]   wire this URL into Stripe / GitHub / Slack webhook configs');
      console.log('');
      if (tunnelArgs.writeEnv) {
        // --tunnel-write-env: persist as TUNNEL_PUBLIC_URL so callers
        // (auth flows, webhook configs reading process.env) can pick
        // it up. Triggers the .env-watch handler below, which respawns
        // the API so the new env var is in scope.
        try {
          const current = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
          const update = planTunnelEnvWrite({ current, url: parsed.url });
          writeFileSync(envPath, update.next, 'utf8');
          console.log('[dev]   TUNNEL_PUBLIC_URL written to .env');
        } catch (err) {
          console.warn(`[dev]   (failed to write TUNNEL_PUBLIC_URL: ${(err as Error).message})`);
        }
      }
    }
    if (parsed.error && !tunnelUrlSeen) {
      console.log(`[cloudflared] ${parsed.error}`);
    }
  };

  const wireStream = (
    stream: NodeJS.ReadableStream | null,
  ): void => {
    if (!stream) return;
    let buffer = '';
    stream.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let nlIdx = buffer.indexOf('\n');
      while (nlIdx !== -1) {
        const line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        onTunnelLine(line);
        nlIdx = buffer.indexOf('\n');
      }
    });
    stream.on('end', () => {
      if (buffer.length > 0) onTunnelLine(buffer);
    });
  };
  wireStream(tunnelChild.stdout);
  wireStream(tunnelChild.stderr);

  tunnelChild.on('exit', (code, signal) => {
    if (!shuttingDown && code !== 0 && code !== null) {
      console.warn(`[dev] cloudflared exited with code ${code} (signal: ${signal ?? 'none'})`);
    }
    clearTunnelState(process.cwd());
  });

  // Belt + suspenders: warn the user if no URL appears within 30s
  // so a misconfigured cloudflared (auth issue, edge unreachable)
  // doesn't silently waste their time.
  setTimeout(() => {
    if (!tunnelUrlSeen && !shuttingDown) {
      console.warn(
        '[dev] cloudflared has not reported a public URL after 30s — check the cloudflared logs above.',
      );
    }
  }, 30_000).unref();
}

function buildSpawnPlan(): SpawnPlan {
  if (usePortless && proxyAlive) {
    // Defence-in-depth against stale registrations. When a previous
    // `bun --watch` was hard-killed (SIGKILL, OOM, terminal closed),
    // its entry in `~/.portless/routes.json` outlives the process and
    // the next dev-boot would otherwise fail with RouteConflictError.
    // We probe the existing PID; if it is dead (or its slot is empty)
    // we let portless evict it via `--force`. Same-PID and
    // different-but-alive PIDs surface portless's normal error.
    const hostname = `api.${projectName}.localhost`;
    const owner = readPortlessRouteOwner(hostname);
    const decision = decideRegistrationAction({
      existingPid: owner?.pid,
      currentPid: process.pid,
      isAlive: owner ? isPidAlive(owner.pid) : false,
    });
    if (decision === 'take-over' && owner) {
      console.log(
        `[dev] taking over stale portless registration for ${hostname} (PID ${owner.pid} is gone)`,
      );
    }
    const args = buildPortlessRunCommand({
      projectName,
      app: 'api',
      target: ['bun', '--watch', 'src/main.ts'],
      force: decision === 'take-over',
    });
    return {
      command: portlessPath!,
      args,
      env: { ...process.env, PORTLESS_ACTIVE: '1' },
    };
  }
  const port = resolveDevPort({
    env: process.env as { PORT?: string },
    portlessAvailable: false,
  });
  return {
    command: 'bun',
    args: ['--watch', 'src/main.ts'],
    env: { ...process.env, PORT: String(port) },
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

function spawnChild(): ChildProcess {
  const plan = buildSpawnPlan();
  const proc = spawn(plan.command, plan.args, { stdio: 'inherit', env: plan.env });
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
let respawnTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRespawn(reason: 'env-change' | 'brand-change'): void {
  if (shuttingDown) return;
  if (respawnTimer) clearTimeout(respawnTimer);
  respawnTimer = setTimeout(() => {
    if (!child || shuttingDown) return;
    console.log(
      reason === 'brand-change'
        ? '[dev] brand.json changed — restarting API so brand propagates everywhere'
        : '[dev] .env changed — restarting API to pick up new env-vars',
    );
    markDevSessionRefresh(process.cwd(), reason);
    respawning = true;
    const old = child;
    old.once('exit', () => {
      respawning = false;
      if (!shuttingDown) child = spawnChild();
    });
    old.kill('SIGTERM');
  }, 200);
}
try {
  watch(envPath, { persistent: false }, () => scheduleRespawn('env-change'));
} catch {
  /* .env may not exist yet — toggling will create it and the next start picks it up */
}

// Watch the project-owned brand.json. The brand-loader caches by
// project root; a full restart (not just `bun --watch`) is the
// safest invalidation path because some modules (Better-Auth issuer,
// EmailModule defaultFrom, OpenAPI title) read the brand once at
// provider init. The default brand.default.json under src/core/ is
// already covered by `bun --watch` since it lives in the source tree.
const brandPath = resolve(process.cwd(), 'src/modules/branding/brand.json');
try {
  watch(brandPath, { persistent: false }, () => scheduleRespawn('brand-change'));
} catch {
  /* brand.json is optional; the next dev-run picks it up if created later */
}

const shutdown = (signal: NodeJS.Signals): void => {
  shuttingDown = true;
  // Stale lock from this session must not bleed into the next `bun
  // run dev` — that would skip the browser open on cold-start.
  clearDevSessionState(process.cwd());
  // Same for the tunnel state — `/dev/tunnel.json` must not report a
  // dead URL after Ctrl-C.
  clearTunnelState(process.cwd());
  if (child) child.kill(signal);
  if (tunnelChild) tunnelChild.kill(signal);
  if (portalWatcher) portalWatcher.kill(signal);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
