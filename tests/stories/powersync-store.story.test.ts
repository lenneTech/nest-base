import { describe, expect, it } from "vitest";

import {
  InMemoryPowerSyncStore,
  POWER_SYNC_STORE,
  PrismaPowerSyncStore,
} from "../../src/core/auth/powersync-store.js";

/**
 * Story · PowerSync persistence layer (CF.PS.04 closure — iter-216).
 *
 * Iter-205's `docs/prd-deviations.md` documented CF.PS.04: the
 * `PowerSyncController` stored mutations in a private
 * `Map<string, StoreRow>` that lost every offline-queued change on
 * process restart. Iter-216 introduces the `PowerSyncStore`
 * abstraction with two adapters:
 *   - `InMemoryPowerSyncStore` — fallback when the powersync feature
 *     schema isn't loaded (story tests, projects without the flag)
 *   - `PrismaPowerSyncStore` — durable adapter against
 *     `power_sync_rows` (composite PK `(tenantId, type, id)`, RLS-
 *     enabled, JSONB payload)
 *
 * The controller's request flow is now: load → resolve → persist.
 * The conflict resolver stays a pure function over a `Map`; the
 * controller hydrates from the store before resolving and writes the
 * resulting Map back atomically afterwards.
 */
describe("Story · PowerSyncStore (CF.PS.04 — iter-216)", () => {
  it("InMemoryPowerSyncStore round-trips upserts + deletes per (tenantId, type, id)", async () => {
    const store = new InMemoryPowerSyncStore();
    const tenant = "11111111-1111-4111-8111-111111111111";
    await store.applyMutations(
      tenant,
      [{ type: "widgets", id: "w1", data: { name: "alpha" }, updatedAt: new Date(0) }],
      [],
    );
    const loaded = await store.loadByTypes(tenant, ["widgets"]);
    expect(loaded.map((r) => ({ type: r.type, id: r.id, name: r.data.name }))).toEqual([
      { type: "widgets", id: "w1", name: "alpha" },
    ]);
    await store.applyMutations(tenant, [], [{ type: "widgets", id: "w1" }]);
    expect(await store.loadByTypes(tenant, ["widgets"])).toEqual([]);
  });

  it("InMemoryPowerSyncStore scopes rows per tenant — cross-tenant load returns nothing", async () => {
    const store = new InMemoryPowerSyncStore();
    const tenantA = "11111111-1111-4111-8111-111111111111";
    const tenantB = "22222222-2222-4222-8222-222222222222";
    await store.applyMutations(
      tenantA,
      [{ type: "widgets", id: "w1", data: { v: 1 }, updatedAt: new Date(0) }],
      [],
    );
    expect(await store.loadByTypes(tenantA, ["widgets"])).toHaveLength(1);
    expect(await store.loadByTypes(tenantB, ["widgets"])).toHaveLength(0);
  });

  it("InMemoryPowerSyncStore.loadByTypes filters by the requested types", async () => {
    const store = new InMemoryPowerSyncStore();
    const tenant = "11111111-1111-4111-8111-111111111111";
    await store.applyMutations(
      tenant,
      [
        { type: "widgets", id: "w1", data: {}, updatedAt: new Date(0) },
        { type: "gadgets", id: "g1", data: {}, updatedAt: new Date(0) },
      ],
      [],
    );
    const widgets = await store.loadByTypes(tenant, ["widgets"]);
    expect(widgets.map((r) => r.type)).toEqual(["widgets"]);
  });

  it("PrismaPowerSyncStore exists as an exported class for the durable adapter", () => {
    expect(PrismaPowerSyncStore).toBeDefined();
    expect(typeof PrismaPowerSyncStore.prototype.loadByTypes).toBe("function");
    expect(typeof PrismaPowerSyncStore.prototype.applyMutations).toBe("function");
  });

  it("POWER_SYNC_STORE token is exported for downstream provider override", () => {
    expect(typeof POWER_SYNC_STORE).toBe("symbol");
    expect(POWER_SYNC_STORE.description).toMatch(/PowerSyncStore/);
  });

  it("the powersync feature schema declares a PowerSyncRow model with composite PK + RLS migration", async () => {
    const { readFileSync } = await import("node:fs");
    const featureSrc = readFileSync("prisma/features/powersync.prisma", "utf8");
    expect(featureSrc).toMatch(/model\s+PowerSyncRow/);
    expect(featureSrc).toMatch(/@@id\(\[tenantId,\s*type,\s*id\]\)/);
    expect(featureSrc).toContain('@@map("power_sync_rows")');
    const migrationSrc = readFileSync(
      "prisma/features/powersync/migrations/20260506220000_power_sync_rows/migration.sql",
      "utf8",
    );
    expect(migrationSrc).toContain('CREATE TABLE "power_sync_rows"');
    expect(migrationSrc).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migrationSrc).toContain("tenant_isolation_power_sync_rows");
  });

  it("docs/prd-deviations.md no longer lists CF.PS.04", async () => {
    const { readFileSync } = await import("node:fs");
    const deviationsSrc = readFileSync("docs/prd-deviations.md", "utf8");
    expect(deviationsSrc).not.toMatch(/^### CF\.PS\.04/m);
  });
});
