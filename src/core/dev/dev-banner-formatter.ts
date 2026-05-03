/**
 * Pure formatters for the dev runner's user-visible banners.
 *
 * Friction 2026-05-03 #14:36 (HIGH) + #14:42 (MEDIUM): `bun run dev`
 * stops mid `RouterExplorer` and never prints any "listening on …" line
 * — the user has no way to learn which port the API took before exit
 * code 144 lands. The runner now emits two lines through these
 * formatters:
 *
 *   1. **Survival banner** — printed *before* `app.listen()` resolves,
 *      synchronously via `process.stdout.write`, so the user sees the
 *      target URL even if a downstream lifecycle hook crashes the
 *      process during route resolution.
 *   2. **Ready line** — printed *after* `app.listen()` resolves, with
 *      the elapsed boot time. This is the canonical "open this URL"
 *      signal a fresh agent / contributor reads.
 *
 * The formatters are pure (`(input) → string`) so all behaviour can be
 * pinned by unit tests without touching processes, files, or sockets.
 * The runner is responsible for deciding *when* to call them; it does
 * the synchronous `process.stdout.write` so the lines cannot be lost in
 * a buffering crash.
 */

export interface DevBannerInput {
  /** Protocol scheme (`http` or `https`). */
  scheme: "http" | "https";
  /** Hostname (no scheme, no port). May contain stray whitespace from env. */
  host: string;
  /**
   * TCP port. Default ports for the scheme (80/443) are omitted from
   * the rendered URL so portless URLs come out clean
   * (`https://api.foo.localhost`, not `https://api.foo.localhost:443`).
   */
  port: number;
}

export interface DevReadyLineInput extends DevBannerInput {
  /** Wall-clock milliseconds between dev-runner start and `listen()` resolve. */
  elapsedMs: number;
}

export interface PortCollisionInput {
  /** The port that could not be bound. */
  port: number;
  /**
   * Optional human-readable hint ("foreign process …", "EADDRINUSE",
   * etc). Surfaces what the runner knows about the holder so the user
   * doesn't have to grep for it.
   */
  holderHint?: string;
}

/**
 * Build a URL from `(scheme, host, port)`, omitting the port when it
 * matches the scheme default. Trims stray whitespace in `host` so
 * env-derived values don't ship with leading/trailing spaces.
 */
function renderUrl(input: DevBannerInput): string {
  const host = input.host.trim();
  const isDefaultPort =
    (input.scheme === "http" && input.port === 80) ||
    (input.scheme === "https" && input.port === 443);
  return isDefaultPort
    ? `${input.scheme}://${host}`
    : `${input.scheme}://${host}:${input.port}`;
}

/**
 * Survival banner — the *first* line the dev runner prints once the
 * port has been resolved. Emitted before NestJS bootstraps so an
 * EADDRINUSE / lifecycle crash later cannot suppress it. Always ends
 * with `\n` because callers use `process.stdout.write` (no implicit
 * newline) to keep the write synchronous.
 */
export function formatDevSurvivalBanner(input: DevBannerInput): string {
  return `[dev] API listening on ${renderUrl(input)}\n`;
}

/**
 * Ready line — printed after `app.listen()` resolves, with elapsed
 * boot time. The em-dash separator is plain ASCII to keep CI log greps
 * (`grep -E "\\[dev\\]"`) free of UTF-8 surprises.
 */
export function formatDevReadyLine(input: DevReadyLineInput): string {
  const ms = Math.round(input.elapsedMs);
  return `[dev] Ready in ${ms}ms — open ${renderUrl(input)}\n`;
}

/**
 * Port-collision message — printed to stderr before the runner exits 1
 * when no fallback port is available. Lists the three escape hatches
 * (stop holder / set PORT / disable portless) so the user has a clear
 * recovery path instead of a silent exit-144.
 */
export function formatPortCollisionMessage(input: PortCollisionInput): string {
  const lines: string[] = [
    `[dev] port ${input.port} is already in use`,
  ];
  if (input.holderHint) {
    lines.push(`[dev]   holder: ${input.holderHint}`);
  }
  lines.push(
    "[dev] try one of:",
    `[dev]   (a) stop the holder process: lsof -i :${input.port} | tail -1`,
    `[dev]   (b) re-run with a free port:  PORT=<other> bun run dev`,
    "[dev]   (c) bypass portless takeover: DISABLE_PORTLESS=1 bun run dev",
    "",
  );
  return lines.join("\n");
}
