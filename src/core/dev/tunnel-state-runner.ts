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

export function tunnelStateLockPath(projectRoot: string): string {
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
