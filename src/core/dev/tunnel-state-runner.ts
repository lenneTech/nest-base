/**
 * Thin runner around `tunnel-state.ts`. Owns file IO and path
 * resolution. The planner is pure and testable; the runner wraps
 * it with `node:fs` and a fixed cache path.
 *
 * Cache lives at `node_modules/.cache/nest-base/tunnel.json` —
 * gitignored, ephemeral, and gone whenever `node_modules` is removed.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseTunnelState, serializeTunnelState, type TunnelState } from "./tunnel-state.js";

const DEFAULT_RELATIVE = "node_modules/.cache/nest-base/tunnel.json";

/**
 * Resolves the tunnel-state lock file path. The path defaults to
 * `<projectRoot>/node_modules/.cache/nest-base/tunnel.json` but can
 * be overridden via the `TUNNEL_STATE_LOCK_PATH` env var so test
 * workers can isolate their lock files when the same project root
 * is shared across multiple parallel processes (iter-146).
 *
 * Production code does not set this env var; the dev runner writes
 * to the default path so the dev-portal endpoint can read it back.
 */
export function tunnelStateLockPath(projectRoot: string): string {
  const override = process.env.TUNNEL_STATE_LOCK_PATH;
  if (override !== undefined && override.length > 0) {
    return resolve(override);
  }
  return resolve(projectRoot, DEFAULT_RELATIVE);
}

export function readTunnelState(projectRoot: string): TunnelState | null {
  const path = tunnelStateLockPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    return parseTunnelState(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeTunnelState(projectRoot: string, state: TunnelState): void {
  const path = tunnelStateLockPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeTunnelState(state), "utf8");
}

export function clearTunnelState(projectRoot: string): void {
  const path = tunnelStateLockPath(projectRoot);
  try {
    rmSync(path, { force: true });
  } catch {
    /* best effort — file may not exist */
  }
}
