/**
 * Thin I/O runner for `~/.portless/routes.json`.
 *
 * Pure decision-making lives in `portless.ts` (`decideRegistrationAction`).
 * This module only provides the side-effecting glue: locate the file,
 * parse it, and probe a PID for liveness. Kept separate so the planner
 * stays unit-testable without a real filesystem or running processes.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Shape of an entry in `~/.portless/routes.json`. Matches what
 * portless 0.11+ writes (`hostname`, `port`, `pid`). Extra keys are
 * tolerated — we only read what we need.
 */
export interface PortlessRouteRecord {
  hostname: string;
  port: number;
  pid: number;
}

/**
 * Resolve the path to portless's user-state routes file. The portless
 * CLI uses `~/.portless` (`USER_STATE_DIR` in their source) for the
 * default per-user state. PORTLESS_STATE_DIR overrides it for tests.
 */
export function resolvePortlessRoutesPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.PORTLESS_STATE_DIR;
  const dir = explicit && explicit.length > 0 ? explicit : join(homedir(), ".portless");
  return join(dir, "routes.json");
}

/**
 * Read the routes file and find the record for `hostname`. Returns the
 * raw record or `undefined` when the file is missing, malformed, or the
 * hostname is not registered. We swallow JSON parse / I/O errors and
 * return `undefined` because the dev runner must keep working even when
 * portless's state directory is fresh / corrupt — the planner's
 * "no-existing" branch handles that case.
 */
export function readPortlessRouteOwner(
  hostname: string,
  routesPath: string = resolvePortlessRoutesPath(),
): PortlessRouteRecord | undefined {
  if (!existsSync(routesPath)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(routesPath, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  for (const entry of parsed) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as { hostname?: unknown }).hostname === "string" &&
      (entry as { hostname: string }).hostname === hostname
    ) {
      const record = entry as Record<string, unknown>;
      const pid = typeof record.pid === "number" ? record.pid : 0;
      const port = typeof record.port === "number" ? record.port : 0;
      return { hostname, port, pid };
    }
  }
  return undefined;
}

/**
 * Probe whether `pid` is alive without sending a signal. `process.kill(pid, 0)`
 * returns successfully when the caller has permission to signal `pid`
 * (which implies the process exists), throws ESRCH when the process is
 * gone, and throws EPERM when the process exists but we lack permission.
 *
 * For our use-case (taking over a stale registration owned by the same
 * user) ESRCH is the only "definitely dead" answer; everything else is
 * conservatively treated as alive so we never `--force` a still-running
 * peer.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return false;
    // EPERM / unknown: process exists but we can't signal — treat as
    // alive so we don't accidentally evict it.
    return true;
  }
}
