/**
 * portless integration (PLAN.md §28.10/#30).
 *
 * Pure functions used by `scripts/dev.ts` to decide whether to boot
 * portless, build its argv, and pick a port for the no-portless
 * fallback. Side-effecting binary lookup + process spawning live in
 * the script — these helpers stay pure so tests can exercise them
 * without touching the filesystem or env.
 *
 * portless 0.11+ replaced its YAML-config model with a per-process CLI:
 * `portless run --name <name> -- <cmd>` wraps a dev command and routes
 * `https://<name>.localhost` to it. The proxy daemon must be running
 * (start once with `portless proxy start`) and the root CA installed
 * (one-time `portless trust`).
 */

export interface ShouldUsePortlessInput {
  /** Absolute path to the portless binary, or `undefined` if not on PATH. */
  portlessPath: string | undefined;
  /** Explicit override (`DISABLE_PORTLESS=1`) — wins over `portlessPath`. */
  disable?: boolean;
}

export function shouldUsePortless(input: ShouldUsePortlessInput): boolean {
  if (input.disable) return false;
  return input.portlessPath !== undefined && input.portlessPath !== '';
}

export interface ResolveDevPortInput {
  env: { PORT?: string };
  portlessAvailable: boolean;
}

const PORTLESS_DEFAULT_PORT = 3000;

/**
 * Resolve the port for the dev server.
 *
 * - explicit `PORT` env-var → use it
 * - portless available     → bind the conventional 3000 (portless will
 *                            override via `PORT=<picked>` when running
 *                            `portless run`, but the planner default is
 *                            preserved for tooling that asks)
 * - portless missing       → bind 0 (dynamic) so multiple checkouts coexist
 */
export function resolveDevPort(input: ResolveDevPortInput): number {
  const raw = input.env.PORT;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      throw new Error(`PORT must be an integer (received: ${raw})`);
    }
    return n;
  }
  return input.portlessAvailable ? PORTLESS_DEFAULT_PORT : 0;
}

export interface BuildPortlessRunCommandInput {
  /** Comes from package.json["name"] — the bottom segment of the URL. */
  projectName: string;
  /** Optional service prefix, e.g. `api` → `api.<projectName>.localhost`. */
  app?: string;
  /** The dev command to wrap, e.g. `['bun', '--watch', 'src/main.ts']`. */
  target: string[];
}

/**
 * Builds the argv for `portless run`. Returns the args *after* the
 * binary path so the caller can spawn `[portlessPath, ...args]`.
 *
 * Format: `run --name <fullName> -- <target...>`.
 * `<fullName>` is `<app>.<projectName>` when `app` is given, otherwise
 * just `<projectName>`. Worktree branch prefixes are added by portless
 * itself if the repo is on a non-default branch.
 */
export function buildPortlessRunCommand(input: BuildPortlessRunCommandInput): string[] {
  if (!input.projectName) {
    throw new Error('buildPortlessRunCommand: projectName must not be empty');
  }
  if (input.target.length === 0) {
    throw new Error('buildPortlessRunCommand: target must not be empty');
  }
  const fullName = input.app ? `${input.app}.${input.projectName}` : input.projectName;
  return ['run', '--name', fullName, '--', ...input.target];
}
