/**
 * Frontend env-bridge planner.
 *
 * Friction-log entry (LLM-test 2026-05-03 #5 high): the setup wizard
 * already detects a busy port 3000 and re-targets the API, but the
 * upstream `nuxt-base-starter`'s `projects/app/.env` still ships
 * hard-coded `NUXT_API_URL=http://localhost:3000` and the Vite proxy
 * is hard-coded too. When 3000 is busy, the frontend silently talks
 * to the wrong backend.
 *
 * The bridge writes the workspace's portless URL + chosen API port
 * into `projects/app/.env` so any standard env-consumer follows the
 * API automatically. Because the URL is portless, a future port
 * reshuffle does NOT require re-running setup; the consumer always
 * resolves to the same `https://api.<project>.localhost`.
 *
 * Pure function: takes the existing `.env` text (or `undefined` if
 * the file is missing) + the target inputs, returns either a
 * `{ action: "skip" }` plan (when `projects/app/` is absent or every
 * key already holds a custom user value) or a `{ action: "write",
 * next }` plan with the rendered file content. The runner does the
 * I/O — see `runSetupWizard()` in `setup-wizard-runner.ts`.
 *
 * Idempotency contract:
 *   - missing key                                    → append.
 *   - sentinel value (default `localhost:<port>`)    → replace.
 *   - sentinel value (own previous wizard write)     → replace (no churn).
 *   - non-sentinel value (custom user override)      → leave alone.
 *
 * Determinism: keys are emitted in ASCII-sorted order so re-running
 * the wizard against the same inputs produces byte-identical output
 * (helps `git diff` reviewers spot real changes, and keeps the
 * append step from drifting between runs).
 */

export interface FrontendEnvBridgeInputs {
  /** Workspace name; powers `https://api.<projectName>.localhost`. */
  projectName: string;
  /** Chosen API host port; written as `API_PORT=<n>` for non-portless consumers. */
  apiPort: number;
  /** When `false`, the planner returns `{ action: "skip" }`. Driven by `existsSync(projects/app)`. */
  appExists: boolean;
  /**
   * Current text of `projects/app/.env`, or `undefined` when the file
   * doesn't exist yet. `""` means the file is empty (treated like
   * `undefined` for content purposes, but the runner still writes).
   */
  currentEnv: string | undefined;
}

export type FrontendEnvBridgePlan =
  | { action: "skip"; reason: SkipReason }
  | { action: "write"; next: string };

export type SkipReason = "frontend-dir-missing" | "all-values-custom-no-write-needed";

/** Marker so re-runs append below the same block instead of trailing-fragmenting. */
export const FRONTEND_ENV_BRIDGE_MARKER = "# Managed by nest-base setup-wizard";

/**
 * Keys we drive. Kept tight — only the upstream-verified consumer
 * shapes plus a small generic superset:
 *   - `NUXT_API_URL`       — server-side (nuxt-base-starter `nuxt.config.ts:91`)
 *   - `NUXT_PUBLIC_API_URL` — client-side (`runtimeConfig.public.apiUrl`)
 *   - `API_URL`            — generic for any consumer not using NUXT_ prefix
 *   - `API_PORT`           — generic numeric port for non-portless setups
 *
 * `NUXT_PUBLIC_API_PROXY` is intentionally NOT touched: it's a boolean
 * toggle whose default in the upstream `.env.example` is already `true`,
 * and writing it would either be a no-op or stomp a deliberate user
 * disable.
 */
const BRIDGE_KEYS = ["NUXT_API_URL", "NUXT_PUBLIC_API_URL", "API_URL", "API_PORT"] as const;

type BridgeKey = (typeof BRIDGE_KEYS)[number];

const ASSIGN_RE = /^([A-Z][A-Z0-9_]*)=(.*)$/;

export function planFrontendEnvBridge(input: FrontendEnvBridgeInputs): FrontendEnvBridgePlan {
  if (!input.projectName) {
    throw new Error("frontend-env-bridge: projectName must be a non-empty string");
  }
  if (!input.appExists) {
    return { action: "skip", reason: "frontend-dir-missing" };
  }

  const portlessUrl = `https://api.${input.projectName}.localhost`;
  const intended: Record<BridgeKey, string> = {
    NUXT_API_URL: portlessUrl,
    NUXT_PUBLIC_API_URL: portlessUrl,
    API_URL: portlessUrl,
    API_PORT: String(input.apiPort),
  };

  const existing = parseEnv(input.currentEnv ?? "");

  // Decide per-key: keep custom value, replace sentinel, or append missing.
  const finalValues: Record<BridgeKey, string> = { ...intended };
  let anySentinelOrMissing = false;
  for (const key of BRIDGE_KEYS) {
    const current = existing.get(key);
    if (current === undefined) {
      anySentinelOrMissing = true;
      continue;
    }
    if (isSentinelValue(key, current, portlessUrl, input.apiPort)) {
      anySentinelOrMissing = true;
      continue;
    }
    // Custom user value — preserve verbatim.
    finalValues[key] = current;
  }

  if (!anySentinelOrMissing) {
    // Every key is already a custom value → nothing to write.
    return { action: "skip", reason: "all-values-custom-no-write-needed" };
  }

  const next = renderEnv(input.currentEnv ?? "", finalValues);
  return { action: "write", next };
}

/**
 * Sentinel detection per key. A "sentinel" is a value the wizard knows
 * it owns: either the upstream-default placeholder, or one of its own
 * past outputs for this project. Anything else is a custom user value
 * and must not be overwritten.
 */
function isSentinelValue(
  key: BridgeKey,
  value: string,
  portlessUrl: string,
  apiPort: number,
): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return true;
  if (key === "API_PORT") {
    if (trimmed === String(apiPort)) return true;
    // Any plain numeric value — likely a previous wizard run with a
    // different chosen port. Treat as sentinel so a port reshuffle
    // propagates to the frontend.
    return /^\d+$/.test(trimmed);
  }
  // URL-shaped keys.
  if (trimmed === portlessUrl) return true;
  // Upstream nuxt-base-starter default sentinel.
  if (trimmed === "http://localhost:3000") return true;
  // Any `http://localhost:<port>` — a previous run wrote this when
  // portless was disabled, or the user copied the upstream default
  // and only swapped the port. Either way: wizard owns it.
  if (/^http:\/\/localhost:\d+\/?$/.test(trimmed)) return true;
  return false;
}

/** Pull KEY=value pairs from a .env-style text, ignoring comments. */
function parseEnv(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimStart();
    if (line.startsWith("#")) continue;
    const m = ASSIGN_RE.exec(raw);
    if (!m) continue;
    out.set(m[1]!, m[2] ?? "");
  }
  return out;
}

/**
 * Render the new `.env` text:
 *   - keep every existing line we did not touch (comments, blanks,
 *     custom keys outside our managed set)
 *   - replace sentinel-valued bridge keys in-place to preserve order
 *   - append missing bridge keys in ASCII-sorted order under the
 *     managed marker (so re-runs idempotently target the same block)
 *
 * The output always ends with a single trailing newline (POSIX).
 */
function renderEnv(current: string, finalValues: Record<BridgeKey, string>): string {
  const lines = current === "" ? [] : current.split(/\r?\n/);
  // Strip a single trailing empty entry from the split (the file ends
  // with `\n`); we'll re-add it at the bottom unconditionally.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const seen = new Set<BridgeKey>();
  const next: string[] = [];
  for (const raw of lines) {
    const m = ASSIGN_RE.exec(raw);
    if (!m) {
      next.push(raw);
      continue;
    }
    const key = m[1]!;
    if (!isBridgeKey(key)) {
      next.push(raw);
      continue;
    }
    seen.add(key);
    next.push(`${key}=${finalValues[key]}`);
  }

  const missing = BRIDGE_KEYS.filter((k) => !seen.has(k))
    .slice()
    .sort();
  if (missing.length > 0) {
    if (next.length > 0 && next[next.length - 1] !== "") next.push("");
    // Don't duplicate the marker if a prior run already laid one down.
    if (!next.some((l) => l.trim() === FRONTEND_ENV_BRIDGE_MARKER)) {
      next.push(FRONTEND_ENV_BRIDGE_MARKER);
    }
    for (const key of missing) {
      next.push(`${key}=${finalValues[key]}`);
    }
  }

  // Ensure a trailing newline (and exactly one).
  let out = next.join("\n");
  while (out.endsWith("\n\n")) out = out.slice(0, -1);
  if (!out.endsWith("\n")) out += "\n";
  return out;
}

function isBridgeKey(key: string): key is BridgeKey {
  return (BRIDGE_KEYS as readonly string[]).includes(key);
}
