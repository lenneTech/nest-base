/**
 * Cloudflare-Tunnel planner — pure functions only.
 *
 * `bun run dev --tunnel` shells out to `cloudflared` so a developer
 * can expose `http://localhost:<port>` to the public internet (typical
 * use: receive Stripe / GitHub / Slack webhooks during local dev). The
 * spawning lives in `scripts/dev.ts`; this module owns the testable
 * decision logic.
 *
 * Two modes:
 *
 * - Quick-Tunnel (default): `cloudflared tunnel --url http://localhost:<port>`
 *   — anonymous, ephemeral, returns a fresh `*.trycloudflare.com` URL
 *   each time. No Cloudflare account required.
 *
 * - Named-Tunnel (advanced opt-in via `CLOUDFLARE_TUNNEL_NAME`):
 *   `cloudflared tunnel run <name>` — stable URL, requires a
 *   pre-configured tunnel + DNS routing in the user's Cloudflare
 *   account. We only build the argv; the user is responsible for
 *   `cloudflared tunnel login` + DNS.
 */

const TRYCLOUDFLARE_HOST_PATTERN = "[a-z0-9-]+\\.trycloudflare\\.com";
const TRYCLOUDFLARE_URL_REGEX = new RegExp(`https://${TRYCLOUDFLARE_HOST_PATTERN}`, "i");

export interface ParseTunnelArgsResult {
  /** True when `--tunnel` (or `--tunnel-write-env`) is set and not overridden. */
  tunnelEnabled: boolean;
  /** True when the user asked for `.env` persistence (`--tunnel-write-env`). */
  writeEnv: boolean;
}

/**
 * Parse the CLI flags `bun run dev` understands for the tunnel
 * subsystem. Last-write-wins so users can compose flags in either
 * order; `--no-tunnel` always overrides any earlier `--tunnel`.
 */
export function parseTunnelArgs(argv: readonly string[]): ParseTunnelArgsResult {
  let tunnelEnabled = false;
  let writeEnv = false;
  for (const arg of argv) {
    if (arg === "--tunnel") {
      tunnelEnabled = true;
    } else if (arg === "--no-tunnel") {
      tunnelEnabled = false;
      writeEnv = false;
    } else if (arg === "--tunnel-write-env") {
      tunnelEnabled = true;
      writeEnv = true;
    }
  }
  return { tunnelEnabled, writeEnv };
}

export interface PlanCloudflaredCommandInput {
  /** The local port `cloudflared` should forward traffic to. */
  port: number;
  /**
   * Optional named-tunnel ID/name. When set (and non-empty after
   * trim), the planner emits `tunnel run <name>` instead of the
   * quick-tunnel `tunnel --url …` form.
   */
  tunnelName?: string;
}

export interface CloudflaredCommandPlan {
  /** Always `cloudflared`. The dev runner is responsible for `which cloudflared`. */
  command: string;
  args: string[];
}

export function planCloudflaredCommand(input: PlanCloudflaredCommandInput): CloudflaredCommandPlan {
  if (!Number.isInteger(input.port) || input.port <= 0) {
    throw new Error(`planCloudflaredCommand: port must be a positive integer (got: ${input.port})`);
  }
  const trimmedName = input.tunnelName?.trim();
  if (trimmedName !== undefined && trimmedName !== "") {
    return { command: "cloudflared", args: ["tunnel", "run", trimmedName] };
  }
  return {
    command: "cloudflared",
    args: ["tunnel", "--url", `http://localhost:${input.port}`],
  };
}

export interface ParseCloudflaredOutputResult {
  /** First `https://*.trycloudflare.com` URL we matched in the line, if any. */
  url?: string;
  /** True once a URL was extracted — banner can flip from "starting" to "ready". */
  ready: boolean;
  /** Set when the line looks like a known cloudflared error. */
  error?: string;
}

const ERROR_LINE_PATTERN = /\b(ERR|ERROR|FATAL)\b|failed to dial|connection refused/i;

/**
 * Pure parser for one cloudflared log line (stderr or stdout). Tries
 * three URL-extraction strategies in order: structured JSON `"url"`
 * field, banner box / `url=` token, and a regex fallback. The
 * earliest match wins so multi-URL lines stay deterministic.
 */
export function parseCloudflaredOutput(line: string): ParseCloudflaredOutputResult {
  // 1. Structured JSON line — cloudflared occasionally emits these.
  const structured = extractStructuredUrl(line);
  if (structured !== undefined) {
    return { url: structured, ready: true };
  }

  // 2. Generic regex match (covers boxed banner + log-line forms).
  const match = TRYCLOUDFLARE_URL_REGEX.exec(line);
  if (match !== null) {
    return { url: match[0], ready: true };
  }

  // 3. Error lines without a URL.
  if (ERROR_LINE_PATTERN.test(line)) {
    return { ready: false, error: line.trim() };
  }

  return { ready: false };
}

function extractStructuredUrl(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as { url?: unknown };
    if (typeof parsed.url === "string" && TRYCLOUDFLARE_URL_REGEX.test(parsed.url)) {
      return parsed.url;
    }
  } catch {
    /* not a JSON line — fall through */
  }
  return undefined;
}

/**
 * Multi-line user-facing message for the missing-binary case. The
 * dev runner prints this and aborts so the user has a clear next
 * step instead of a cryptic ENOENT.
 */
export function formatMissingCloudflaredHint(): string {
  return [
    "[dev] --tunnel requested but `cloudflared` is not on PATH.",
    "",
    "  • macOS:   brew install cloudflared",
    "  • Linux:   https://github.com/cloudflare/cloudflared/releases",
    "  • Windows: winget install --id Cloudflare.cloudflared",
    "",
    "After installing, run `bun run dev --tunnel` again.",
  ].join("\n");
}

export interface PlanTunnelEnvWriteInput {
  /** Current `.env` text (may be empty). */
  current: string;
  /** The discovered tunnel URL to persist. */
  url: string;
  /**
   * Allow non-trycloudflare URLs (named-tunnel custom domains like
   * `https://api.example.com`). Default: false. Off-by-default keeps
   * the planner safe against a malicious cloudflared output.
   */
  allowAnyHttps?: boolean;
}

export interface PlanTunnelEnvWriteResult {
  /** Updated `.env` text — write this back atomically. */
  next: string;
}

/**
 * Replace (or append) `TUNNEL_PUBLIC_URL=<url>` in the supplied
 * `.env` text. Throws when the URL is not safe to persist (shell
 * injection, non-https, non-trycloudflare under default policy).
 */
export function planTunnelEnvWrite(input: PlanTunnelEnvWriteInput): PlanTunnelEnvWriteResult {
  validateTunnelUrl(input.url, input.allowAnyHttps === true);

  const KEY = "TUNNEL_PUBLIC_URL";
  const lines = input.current.split("\n");
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.startsWith(`${KEY}=`)) {
      replaced = true;
      return `${KEY}=${input.url}`;
    }
    return line;
  });
  if (replaced) {
    return { next: nextLines.join("\n") };
  }
  // Append: ensure exactly one trailing newline so the file stays
  // POSIX-clean.
  const base =
    input.current.endsWith("\n") || input.current === "" ? input.current : `${input.current}\n`;
  return { next: `${base}${KEY}=${input.url}\n` };
}

function validateTunnelUrl(url: string, allowAnyHttps: boolean): void {
  if (typeof url !== "string" || url === "") {
    throw new Error("planTunnelEnvWrite: url must be a non-empty string");
  }
  if (/[\r\n]/.test(url)) {
    throw new Error("planTunnelEnvWrite: url must not contain newlines (env-file injection)");
  }
  if (!url.startsWith("https://")) {
    throw new Error("planTunnelEnvWrite: url must start with https://");
  }
  if (allowAnyHttps) return;
  if (!TRYCLOUDFLARE_URL_REGEX.test(url)) {
    throw new Error(
      "planTunnelEnvWrite: url must point to *.trycloudflare.com (set allowAnyHttps for named tunnels)",
    );
  }
}
