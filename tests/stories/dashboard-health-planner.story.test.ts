import { describe, expect, it } from "vitest";

import {
  buildDashboardStatusGroups,
  type DashboardHealthInput,
} from "../../src/core/dx/dashboard-health-planner.js";

/**
 * Story · `buildDashboardStatusGroups` — pure planner for the operator
 * dashboard status cards. No I/O; deterministic given the same input.
 */

const healthy: DashboardHealthInput = {
  uptime: 3600,
  heapUsedMb: 120,
  rssMb: 200,
  bunVersion: "1.1.38",
  pendingJobCount: 0,
  deadLetterCount: 0,
  webhookSuccessRate: 0.98,
  emailEnabled: true,
  storageDriverName: "local",
  geoIpAgeDays: 5,
  allMigrationsApplied: true,
  rlsActive: true,
};

describe("buildDashboardStatusGroups", () => {
  it("returns four groups with deterministic IDs", () => {
    const groups = buildDashboardStatusGroups(healthy);
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual(["database", "async", "external", "runtime"]);
  });

  it("all healthy inputs → all groups ok", () => {
    const groups = buildDashboardStatusGroups(healthy);
    for (const g of groups) {
      expect(g.status, `group ${g.id} should be ok`).toBe("ok");
    }
  });

  it("missing migration → database group error", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, allMigrationsApplied: false });
    const db = groups.find((g) => g.id === "database");
    expect(db?.status).toBe("error");
  });

  it("RLS inactive → database group warn", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, rlsActive: false });
    const db = groups.find((g) => g.id === "database");
    expect(db?.status).toBe("warn");
  });

  it("dead letters > 0 → async group error", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, deadLetterCount: 3 });
    const async_ = groups.find((g) => g.id === "async");
    expect(async_?.status).toBe("error");
  });

  it("webhook success rate 0.85 → async group warn", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, webhookSuccessRate: 0.85 });
    const async_ = groups.find((g) => g.id === "async");
    expect(async_?.status).toBe("warn");
  });

  it("webhook success rate 0.70 → async group error", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, webhookSuccessRate: 0.7 });
    const async_ = groups.find((g) => g.id === "async");
    expect(async_?.status).toBe("error");
  });

  it("geoIP age > 30 days → external group item warn (group stays ok otherwise)", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, geoIpAgeDays: 45 });
    const ext = groups.find((g) => g.id === "external");
    const geoItem = ext?.items.find((i) => i.label.toLowerCase().includes("geo"));
    expect(geoItem?.status).toBe("warn");
    // Group level escalates to warn when any item is warn
    expect(ext?.status).toBe("warn");
  });

  it("heap > 800 MB → runtime group error", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, heapUsedMb: 850 });
    const rt = groups.find((g) => g.id === "runtime");
    expect(rt?.status).toBe("error");
  });

  it("heap 600 MB → runtime group warn", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, heapUsedMb: 600 });
    const rt = groups.find((g) => g.id === "runtime");
    expect(rt?.status).toBe("warn");
  });

  it("is deterministic — same input produces same output", () => {
    const a = buildDashboardStatusGroups(healthy);
    const b = buildDashboardStatusGroups(healthy);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("each group exposes label and items array", () => {
    const groups = buildDashboardStatusGroups(healthy);
    for (const g of groups) {
      expect(typeof g.label).toBe("string");
      expect(g.label.length).toBeGreaterThan(0);
      expect(Array.isArray(g.items)).toBe(true);
    }
  });
});
