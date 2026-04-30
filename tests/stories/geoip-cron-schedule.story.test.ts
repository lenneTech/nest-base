import { describe, expect, it } from "vitest";

import { planGeoIpRefreshSchedule } from "../../src/core/geoip/refresh-schedule.js";

/**
 * Story · GeoIp Refresh Schedule
 *
 * Pure planner that decides the cron tick interval for the
 * auto-refresh worker. dbip-lite ships a fresh build the first day
 * of the month → check daily, refresh once a month is enough.
 * MaxMind ships weekly → check daily, refresh once a week.
 *
 * Returning the interval as a number of milliseconds keeps the
 * runner trivial: `setInterval(plan.tickMs, …)`. The planner is
 * pure so the cadence-per-provider contract is unit-testable
 * without spawning timers.
 */
describe("Story · GeoIp Refresh Schedule", () => {
  it("dbip-lite: monthly cadence, daily tick (24h)", () => {
    const plan = planGeoIpRefreshSchedule({ provider: "dbip-lite", enabled: true });
    expect(plan.shouldRun).toBe(true);
    expect(plan.cadence).toBe("monthly");
    expect(plan.tickMs).toBe(24 * 60 * 60 * 1000);
    expect(plan.refreshIntervalMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("maxmind: weekly cadence, daily tick (24h)", () => {
    const plan = planGeoIpRefreshSchedule({ provider: "maxmind", enabled: true });
    expect(plan.shouldRun).toBe(true);
    expect(plan.cadence).toBe("weekly");
    expect(plan.tickMs).toBe(24 * 60 * 60 * 1000);
    expect(plan.refreshIntervalMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("disabled feature: shouldRun=false, kein Tick", () => {
    const plan = planGeoIpRefreshSchedule({ provider: "dbip-lite", enabled: false });
    expect(plan.shouldRun).toBe(false);
    expect(plan.tickMs).toBe(0);
  });

  it("isRefreshDue prüft die Distanz seit dem letzten Lauf", () => {
    const plan = planGeoIpRefreshSchedule({ provider: "dbip-lite", enabled: true });
    const now = Date.parse("2026-04-15T00:00:00Z");
    // Letzter Run vor 1 Tag → noch nicht due (monatlich = 30d).
    expect(plan.isRefreshDue(now, now - 24 * 60 * 60 * 1000)).toBe(false);
    // Letzter Run vor 31 Tagen → due.
    expect(plan.isRefreshDue(now, now - 31 * 24 * 60 * 60 * 1000)).toBe(true);
    // Noch nie gelaufen → immer due.
    expect(plan.isRefreshDue(now, null)).toBe(true);
  });

  it("isRefreshDue ist für maxmind weekly empfindlicher", () => {
    const plan = planGeoIpRefreshSchedule({ provider: "maxmind", enabled: true });
    const now = Date.parse("2026-04-15T00:00:00Z");
    // 8 Tage her → due (wöchentlich = 7d).
    expect(plan.isRefreshDue(now, now - 8 * 24 * 60 * 60 * 1000)).toBe(true);
    // 6 Tage her → noch nicht due.
    expect(plan.isRefreshDue(now, now - 6 * 24 * 60 * 60 * 1000)).toBe(false);
  });
});
