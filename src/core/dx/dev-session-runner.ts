/**
 * Thin runner around `dev-session.ts`.
 *
 * Owns file IO + path resolution. The planner is pure and testable;
 * the runner wraps it with `node:fs` and a fixed cache path.
 *
 * Cache lives at `node_modules/.cache/nest-base/dev-session.json` —
 * gitignored, ephemeral, and gone whenever `node_modules` is removed.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  type DevSessionReason,
  type DevSessionState,
  buildDevSessionRefreshState,
  parseDevSessionState,
  planDevSessionStart,
  planDevSessionTransition,
  serializeDevSessionState,
} from "./dev-session.js";

const DEFAULT_RELATIVE = "node_modules/.cache/nest-base/dev-session.json";

export function devSessionLockPath(projectRoot: string): string {
  return resolve(projectRoot, DEFAULT_RELATIVE);
}

export function readDevSessionState(projectRoot: string): DevSessionState | null {
  const path = devSessionLockPath(projectRoot);
  if (!existsSync(path)) return null;
  try {
    return parseDevSessionState(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function writeDevSessionState(projectRoot: string, state: DevSessionState): void {
  const path = devSessionLockPath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeDevSessionState(state), "utf8");
}

export function clearDevSessionState(projectRoot: string): void {
  const path = devSessionLockPath(projectRoot);
  try {
    rmSync(path, { force: true });
  } catch {
    /* best effort — file may not exist */
  }
}

/** Called by `scripts/dev.ts` at startup. Always overwrites. */
export function startDevSession(projectRoot: string): DevSessionState {
  const existing = readDevSessionState(projectRoot);
  const plan = planDevSessionStart({ existing, now: Date.now() });
  writeDevSessionState(projectRoot, plan.state);
  return plan.state;
}

/**
 * Called by `scripts/dev.ts` before respawning the child after a `.env`
 * change. The next bootstrap then renders the env-change banner.
 */
export function markDevSessionRefresh(projectRoot: string, reason: DevSessionReason): void {
  const existing = readDevSessionState(projectRoot);
  if (!existing) return;
  const next = buildDevSessionRefreshState({ existing, reason });
  writeDevSessionState(projectRoot, next);
}

/**
 * Called by `bootstrap.ts` on every NestJS init. Returns a plan
 * (open browser? which banner?) and persists the next state.
 */
export function transitionDevSession(projectRoot: string): {
  shouldOpenBrowser: boolean;
  bannerVariant: "hero" | "restart-watch" | "restart-env" | "restart-brand";
  state: DevSessionState;
} {
  const existing = readDevSessionState(projectRoot);
  const plan = planDevSessionTransition({ existing });
  writeDevSessionState(projectRoot, plan.next);
  return {
    shouldOpenBrowser: plan.shouldOpenBrowser,
    bannerVariant: plan.bannerVariant,
    state: plan.next,
  };
}
