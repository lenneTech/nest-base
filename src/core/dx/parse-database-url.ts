/**
 * Pure parser for `DATABASE_URL` that extracts the (host, port) the
 * onboard TCP probe needs.
 *
 * `bun run onboard` previously reported "Postgres reachable" by URL-
 * parsing alone — a syntactically valid URL with the wrong host
 * returned true. We now do an honest TCP probe (in `onboard.ts`
 * runner), and this planner gives it a typed (host, port) target.
 *
 * Returns `null` for non-postgres schemes, malformed URLs, empty
 * hostnames, or undefined input. The runner treats `null` as
 * "unprobeable" and reports BLOCKED with a clear remediation hint.
 */

export interface DatabaseProbeTarget {
  host: string;
  port: number;
}

const DEFAULT_PG_PORT = 5432;

export function parseDatabaseUrlForProbe(url: string | undefined): DatabaseProbeTarget | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Postgres + Postgres-Alias only; non-pg schemes (mysql, file, etc.)
  // would mislead the probe.
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return null;
  }
  // `URL` percent-decodes the hostname automatically only after
  // explicit decode — call it so unix socket paths land readable.
  const host = decodeURIComponent(parsed.hostname);
  if (host.length === 0) return null;
  const port = parsed.port ? Number.parseInt(parsed.port, 10) : DEFAULT_PG_PORT;
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return { host, port };
}
