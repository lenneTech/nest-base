/**
 * Tunnel-state planner — pure parse/serialize for the JSON lock file
 * `scripts/dev.ts` writes when `--tunnel` discovers a Cloudflare URL.
 *
 * The state file lives in `node_modules/.cache/nest-base/tunnel.json`
 * (gitignored, ephemeral). The dev runner owns writes; the NestJS
 * API child reads it on demand for `GET /dev/tunnel.json`.
 */

export interface TunnelState {
  /** Public URL — `https://*.trycloudflare.com` or a named-tunnel custom domain. */
  url: string;
  /** ISO timestamp of when the URL was first discovered. */
  startedAt: string;
}

export function serializeTunnelState(state: TunnelState): string {
  return `${JSON.stringify({ url: state.url, startedAt: state.startedAt })}\n`;
}

/**
 * Parse a previously serialized state. Returns `null` for any
 * malformed payload — callers treat that as "no active tunnel" so
 * a corrupted lock file never crashes the API.
 */
export function parseTunnelState(text: string): TunnelState | null {
  try {
    const parsed = JSON.parse(text) as { url?: unknown; startedAt?: unknown };
    if (typeof parsed.url !== "string" || parsed.url === "") return null;
    if (!parsed.url.startsWith("https://")) return null;
    if (typeof parsed.startedAt !== "string" || parsed.startedAt === "") return null;
    return { url: parsed.url, startedAt: parsed.startedAt };
  } catch {
    return null;
  }
}
