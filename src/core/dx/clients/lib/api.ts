/**
 * Tiny `fetch` wrapper used by every page's react-query loader.
 *
 * Centralises the Accept header (forces server-side `*.json`
 * branches when a controller checks for it) and the error message
 * shape so an offline endpoint surfaces the same way across pages.
 */

export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      /* swallow — the status alone is sufficient signal */
    }
    throw new Error(`${url} → ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

export function levelName(level: number): string {
  if (level >= 60) return "fatal";
  if (level >= 50) return "error";
  if (level >= 40) return "warn";
  if (level >= 30) return "info";
  if (level >= 20) return "debug";
  return "trace";
}

/** Format a millisecond duration for the dashboard hero / stats. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** Format a test duration — sub-second gets ms, otherwise seconds with 2 decimals. */
export function formatTestDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Format bytes the way `diagnostics-ui.ts` does. */
export function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Format a Prisma-event millisecond duration for the queries page. */
export function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(1)} ms`;
  return `${Math.round(ms)} ms`;
}

/** Strip `http://` / `https://` for the dashboard hero "base URL" tile. */
export function stripProto(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
