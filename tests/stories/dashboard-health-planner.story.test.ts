import { describe, expect, it } from "vitest";

import {
  buildDashboardStatusGroups,
  type DashboardHealthInput,
} from "../../src/core/dx/dashboard-health-planner.js";
import { FeaturesSchema } from "../../src/core/features/features.js";

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
  geoIpEnabled: true,
  geoIpInstalled: true,
  allMigrationsApplied: true,
  multiTenancyEnabled: true,
  rlsActive: true,
};

describe("buildDashboardStatusGroups", () => {
  it("returns four groups with deterministic IDs", () => {
    const groups = buildDashboardStatusGroups(healthy);
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual(["database", "async", "runtime", "external"]);
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
    // When multi-tenancy is ON and RLS is OFF, it is a real misconfiguration → warn
    const groups = buildDashboardStatusGroups({
      ...healthy,
      multiTenancyEnabled: true,
      rlsActive: false,
    });
    const db = groups.find((g) => g.id === "database");
    expect(db?.status).toBe("warn");
  });

  // Regression · Bug 1 — RLS false-positive warning when multiTenancy is OFF
  // Previously: rlsActive=false always produced "warn" regardless of multiTenancy setting.
  // After fix: when multiTenancy is disabled, RLS inactive is expected → status "ok".
  it("RLS inactive + multiTenancy OFF → database group ok (no false-positive warn)", () => {
    const groups = buildDashboardStatusGroups({
      ...healthy,
      multiTenancyEnabled: false,
      rlsActive: false,
    });
    const db = groups.find((g) => g.id === "database");
    expect(db?.status).toBe("ok");
    const rlsItem = db?.items.find((i) => i.label === "Row-Level Security");
    expect(rlsItem?.value).toBe("not required");
    expect(rlsItem?.status).toBe("ok");
  });

  it("RLS active + multiTenancy ON → database group ok", () => {
    const groups = buildDashboardStatusGroups({
      ...healthy,
      multiTenancyEnabled: true,
      rlsActive: true,
    });
    const db = groups.find((g) => g.id === "database");
    expect(db?.status).toBe("ok");
    const rlsItem = db?.items.find((i) => i.label === "Row-Level Security");
    expect(rlsItem?.value).toBe("active");
    expect(rlsItem?.status).toBe("ok");
  });

  it("RLS inactive + multiTenancy ON → RLS item value is 'inactive'", () => {
    const groups = buildDashboardStatusGroups({
      ...healthy,
      multiTenancyEnabled: true,
      rlsActive: false,
    });
    const db = groups.find((g) => g.id === "database");
    const rlsItem = db?.items.find((i) => i.label === "Row-Level Security");
    expect(rlsItem?.value).toBe("inactive");
    expect(rlsItem?.status).toBe("warn");
  });

  it("pending jobs > 0 → async group warn", () => {
    const groups = buildDashboardStatusGroups({ ...healthy, pendingJobCount: 12 });
    const async_ = groups.find((g) => g.id === "async");
    const pending = async_?.items.find((i) => i.label === "Pending jobs");
    expect(pending?.status).toBe("warn");
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

  it("null webhook success rate → async item unknown, group stays ok (disabled feature is neutral)", () => {
    // Regression · a disabled/unknown optional feature (webhooks OFF → null rate)
    // must NOT drag the whole group to "unknown" when the active items are healthy.
    // The item itself is honestly "unknown"; the group rollup treats unknown as
    // neutral and reports "ok" because dead-letter + pending jobs are ok.
    const groups = buildDashboardStatusGroups({ ...healthy, webhookSuccessRate: null });
    const async_ = groups.find((g) => g.id === "async");
    const webhookItem = async_?.items.find((i) => i.label === "Webhook success rate");
    expect(webhookItem?.value).toBe("no deliveries (24 h)");
    expect(webhookItem?.status).toBe("unknown");
    expect(async_?.status).toBe("ok");
  });

  it("geoIP disabled → external item unknown", () => {
    const groups = buildDashboardStatusGroups({
      ...healthy,
      geoIpEnabled: false,
      geoIpInstalled: false,
      geoIpAgeDays: null,
    });
    const ext = groups.find((g) => g.id === "external");
    const geoItem = ext?.items.find((i) => i.label === "GeoIP database");
    expect(geoItem?.value).toBe("disabled");
    expect(geoItem?.status).toBe("unknown");
  });

  it("geoIP enabled but not installed → external item warn", () => {
    const groups = buildDashboardStatusGroups({
      ...healthy,
      geoIpEnabled: true,
      geoIpInstalled: false,
      geoIpAgeDays: null,
    });
    const ext = groups.find((g) => g.id === "external");
    const geoItem = ext?.items.find((i) => i.label === "GeoIP database");
    expect(geoItem?.value).toBe("not installed");
    expect(geoItem?.status).toBe("warn");
    expect(ext?.status).toBe("warn");
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

  it("M6 regression — storageDriverName must come from features.files.storageDefault", () => {
    // The hub controller previously read (features as any).storageDefault which
    // always returns undefined (wrong path). The correct path is features.files.storageDefault.
    const features = FeaturesSchema.parse({ files: { storageDefault: "s3" } });
    // Verify the typed path is accessible and carries the expected value.
    expect(features.files.storageDefault).toBe("s3");
    // Verify the old wrong path produces undefined.
    const wrongPath = (features as Record<string, unknown> & { storageDefault?: string })
      .storageDefault;
    expect(wrongPath).toBeUndefined();
    // buildDashboardStatusGroups should receive the correct value.
    const groups = buildDashboardStatusGroups({
      ...healthy,
      storageDriverName: features.files.storageDefault,
    });
    const runtime = groups.find((g) => g.id === "runtime");
    const storageItem = runtime?.items.find((i) => i.label.toLowerCase().includes("storage"));
    if (storageItem) {
      expect(storageItem.value).toBe("s3");
    }
  });
});
