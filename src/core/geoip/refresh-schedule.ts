import type { GeoIpProvider } from "./download-planner.js";

/**
 * GeoIp refresh schedule — pure planner.
 *
 * The refresh worker ticks daily and only re-downloads the `.mmdb`
 * once `refreshIntervalMs` has elapsed since the last successful
 * run. This is deliberately conservative:
 *
 *   - dbip-lite ships a fresh build at the start of every month;
 *     refreshing more often than `~30 days` wastes bandwidth.
 *   - MaxMind ships weekly. `~7 days` matches the upstream cadence.
 *
 * The runner — a cron / pg-boss job — calls `isRefreshDue(now,
 * lastRunAt)` before kicking off the planner+runner pair. Splitting
 * the decision out of the runner keeps the cadence policy
 * unit-testable.
 */

export type GeoIpRefreshCadence = "monthly" | "weekly";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface GeoIpRefreshSchedule {
  shouldRun: boolean;
  cadence: GeoIpRefreshCadence;
  /** How often the cron wakes up. Always 24h once enabled. */
  tickMs: number;
  /** Minimum time between successive refreshes. */
  refreshIntervalMs: number;
  /** Pure decision helper — true when `now - lastRunAt >= refreshIntervalMs`. */
  isRefreshDue(nowMs: number, lastRunMs: number | null): boolean;
}

export interface PlanGeoIpRefreshScheduleInput {
  provider: GeoIpProvider;
  enabled: boolean;
}

export function planGeoIpRefreshSchedule(
  input: PlanGeoIpRefreshScheduleInput,
): GeoIpRefreshSchedule {
  if (!input.enabled) {
    return {
      shouldRun: false,
      cadence: "monthly",
      tickMs: 0,
      refreshIntervalMs: 0,
      isRefreshDue: () => false,
    };
  }

  const cadence: GeoIpRefreshCadence = input.provider === "maxmind" ? "weekly" : "monthly";
  const refreshIntervalMs = cadence === "monthly" ? 30 * DAY_MS : 7 * DAY_MS;
  return {
    shouldRun: true,
    cadence,
    tickMs: DAY_MS,
    refreshIntervalMs,
    isRefreshDue(nowMs, lastRunMs) {
      if (lastRunMs === null) return true;
      return nowMs - lastRunMs >= refreshIntervalMs;
    },
  };
}
