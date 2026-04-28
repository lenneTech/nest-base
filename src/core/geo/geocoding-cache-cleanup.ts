/**
 * GeocodingCache cleanup planner (PLAN.md §15.6 + §32 Phase 5c).
 *
 * Pure function: given the current time + a retention window,
 * return the WHERE clause + cutoff timestamp the cleanup cron runs
 * daily. The runner side (DELETE statement + pg-boss cron
 * registration) lives in the persistence layer.
 *
 * Default retention is 90 days. The WHERE clause filters BOTH on
 * `createdAt < cutoff` AND `expiresAt < cutoff` (joined with OR) so
 * a row that was inserted with a custom shorter expiresAt also gets
 * cleaned even if it's younger than the retention window.
 */

export const DEFAULT_GEOCODING_CACHE_RETENTION_DAYS = 90;

export interface GeocodingCleanupInput {
  /** Current Unix-millis. Inject `Date.now()` from the runner. */
  now: number;
  /** Retention window in days. Default 90. */
  retentionDays?: number;
}

export interface GeocodingCleanupPlan {
  /** Unix-millis cutoff — anything older gets cleaned. */
  cutoffMs: number;
  /** ISO string version, ready for SQL parameter substitution. */
  cutoffIso: string;
  /** Parameterised WHERE clause (uses $1, $2 binds). */
  where: string;
  /** Parameter array, in the order the WHERE binds them. */
  params: string[];
}

export function buildGeocodingCleanupPlan(input: GeocodingCleanupInput): GeocodingCleanupPlan {
  const retentionDays = input.retentionDays ?? DEFAULT_GEOCODING_CACHE_RETENTION_DAYS;
  if (retentionDays <= 0) {
    throw new Error(`geo-cache-cleanup: retentionDays must be > 0 (got ${retentionDays})`);
  }
  const cutoffMs = input.now - retentionDays * 24 * 3_600 * 1_000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  return {
    cutoffMs,
    cutoffIso,
    where: '"createdAt" < $1 OR "expiresAt" < $2',
    params: [cutoffIso, cutoffIso],
  };
}
