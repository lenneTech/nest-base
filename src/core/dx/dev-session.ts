/**
 * Pure planner for the dev-session lock.
 *
 * Why this exists:
 *
 * `bun --watch src/main.ts` re-execs the child process on every source
 * change. That re-exec resets `process.env` to the env captured at the
 * original spawn, which means a `process.env.DEV_HUB_OPENED = "1"`
 * mutation done after the browser opens is **lost** on the next code
 * save — and the Dev Hub tab pops open again on every keystroke.
 *
 * We persist a tiny JSON file across the watch boundary instead. The
 * file lives in `node_modules/.cache/nest-base/dev-session.json` (same
 * lifetime as the dev runner — gone when `node_modules` is removed)
 * and tracks:
 *
 *   - `sessionId`      — random per `bun run dev` invocation; lets us
 *                        ignore stale lock files from a previous run.
 *   - `startedAtMs`    — for logging/debug only.
 *   - `devHubOpened`   — `true` after the first bootstrap opens the
 *                        browser. Subsequent boots (watch reloads, env
 *                        respawns) read this flag and skip the open.
 *   - `lastReason`     — one of `'initial' | 'watch' | 'env-change'`.
 *                        Lets the startup banner pick a variant: full
 *                        hero (initial), compact "♻ code change"
 *                        (watch), or compact "♻ .env change"
 *                        (env-change). `env-change` is set by the dev
 *                        runner before it respawns; bootstrap consumes
 *                        it once and resets to `'watch'`.
 *
 * The runner half (file IO, lifetime) lives in `dev-session-runner.ts`.
 */

export type DevSessionReason = "initial" | "watch" | "env-change";

export interface DevSessionState {
  sessionId: string;
  startedAtMs: number;
  devHubOpened: boolean;
  lastReason: DevSessionReason;
}

export type BannerVariant = "hero" | "restart-watch" | "restart-env";

export interface DevSessionStartPlan {
  action: "write";
  state: DevSessionState;
}

export interface DevSessionTransitionPlan {
  shouldOpenBrowser: boolean;
  bannerVariant: BannerVariant;
  next: DevSessionState;
}

function randomId(): string {
  // Cryptographic strength is irrelevant — this only needs to be
  // unique within the same machine within the same minute.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function defaultDevSessionState(): DevSessionState {
  return {
    sessionId: randomId(),
    startedAtMs: Date.now(),
    devHubOpened: false,
    lastReason: "initial",
  };
}

/**
 * Plan emitted by the dev runner at startup. Always overwrites — a
 * stale lock from a previous (crashed?) run must not bleed into a new
 * dev session.
 */
export function planDevSessionStart(input: {
  existing: DevSessionState | null;
  now: number;
}): DevSessionStartPlan {
  return {
    action: "write",
    state: {
      sessionId: randomId(),
      startedAtMs: input.now,
      devHubOpened: false,
      lastReason: "initial",
    },
  };
}

/**
 * Plan emitted by `bootstrap.ts` on every NestJS init. Reads the lock,
 * decides whether to open the browser and which banner to render, and
 * returns the next state (which the runner writes back).
 */
export function planDevSessionTransition(input: {
  existing: DevSessionState | null;
}): DevSessionTransitionPlan {
  const existing = input.existing;
  // No lock at all (or unparseable) ⇒ behave like initial: maybe the
  // dev runner crashed, maybe we're under `bun src/main.ts` directly.
  if (!existing) {
    return {
      shouldOpenBrowser: true,
      bannerVariant: "hero",
      next: { ...defaultDevSessionState(), devHubOpened: true },
    };
  }
  if (!existing.devHubOpened) {
    return {
      shouldOpenBrowser: true,
      bannerVariant: "hero",
      next: { ...existing, devHubOpened: true, lastReason: "watch" },
    };
  }
  // Already opened in this session — this is a re-init.
  const variant: BannerVariant =
    existing.lastReason === "env-change" ? "restart-env" : "restart-watch";
  return {
    shouldOpenBrowser: false,
    bannerVariant: variant,
    // Consume env-change reason so the next plain code-save shows the
    // watch banner instead of repeating "env change".
    next: { ...existing, devHubOpened: true, lastReason: "watch" },
  };
}

/**
 * Pre-respawn hook for the dev runner. Sets the `lastReason` flag the
 * next bootstrap will read and react to.
 */
export function buildDevSessionRefreshState(input: {
  existing: DevSessionState;
  reason: DevSessionReason;
}): DevSessionState {
  return { ...input.existing, lastReason: input.reason };
}

export function serializeDevSessionState(state: DevSessionState): string {
  return JSON.stringify(state);
}

export function parseDevSessionState(input: string): DevSessionState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.sessionId !== "string") return null;
  if (typeof obj.startedAtMs !== "number") return null;
  if (typeof obj.devHubOpened !== "boolean") return null;
  if (
    obj.lastReason !== "initial" &&
    obj.lastReason !== "watch" &&
    obj.lastReason !== "env-change"
  ) {
    return null;
  }
  return {
    sessionId: obj.sessionId,
    startedAtMs: obj.startedAtMs,
    devHubOpened: obj.devHubOpened,
    lastReason: obj.lastReason,
  };
}
