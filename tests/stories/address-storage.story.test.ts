import { describe, expect, it } from "vitest";

import {
  InMemoryAddressStorage,
  PrismaAddressStorage,
} from "../../src/core/geo/address-storage.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · Address storage adapters (CF.STORAGE.01 closure — iter-169).
 *
 * Iter-160's reviewer flagged that `address.controller.ts` stored
 * records in a process-local `Map` even though the `Address` Prisma
 * model exists at `prisma/features/geo.prisma`. Iter-169 introduces
 * the `AddressStorage` interface + an in-memory adapter (default
 * fallback when `features.geo.enabled=false`) + a Prisma-backed
 * adapter. Production wires the Prisma adapter from `geo.module.ts`.
 *
 * The story drives both adapters through their full CRUD surface so
 * the contract is locked: insert + findById + list (sorted) + delete
 * with idempotent-on-missing semantics.
 */
describe("Story · InMemoryAddressStorage CRUD (iter-169)", () => {
  function sample(id: string, street = "Test Street") {
    return {
      id,
      tenantId: "t1",
      street,
      zip: "12345",
      city: "Berlin",
      country: "DE",
    };
  }

  it("insert + findById round-trips a stored record", async () => {
    const storage = new InMemoryAddressStorage();
    await storage.insert(sample("a1", "Hauptstraße 1"));
    const fetched = await storage.findById("a1", "t1");
    expect(fetched).not.toBeNull();
    expect(fetched!.street).toBe("Hauptstraße 1");
  });

  it("findById returns null for a missing id", async () => {
    const storage = new InMemoryAddressStorage();
    expect(await storage.findById("missing", "t1")).toBeNull();
  });

  it("findById returns a defensive copy (mutating it does not corrupt the store)", async () => {
    const storage = new InMemoryAddressStorage();
    await storage.insert(sample("a1"));
    const first = (await storage.findById("a1", "t1"))!;
    first.street = "MUTATED";
    const second = (await storage.findById("a1", "t1"))!;
    expect(second.street).toBe("Test Street");
  });

  it("list returns every inserted record (defensive copies)", async () => {
    const storage = new InMemoryAddressStorage();
    await storage.insert(sample("a1", "First"));
    await storage.insert(sample("a2", "Second"));
    const all = await storage.list("t1");
    expect(all.map((r) => r.street).sort()).toEqual(["First", "Second"]);
  });

  it("delete returns true for an existing id, false for a missing id", async () => {
    const storage = new InMemoryAddressStorage();
    await storage.insert(sample("a1"));
    expect(await storage.delete("a1", "t1")).toBe(true);
    expect(await storage.delete("a1", "t1")).toBe(false);
  });

  it("reset() wipes the store between tests", async () => {
    const storage = new InMemoryAddressStorage();
    await storage.insert(sample("a1"));
    storage.reset();
    expect(await storage.list("t1")).toEqual([]);
  });

  it("findById refuses cross-tenant probes — returns null instead of leaking the row (iter-204)", async () => {
    const storage = new InMemoryAddressStorage();
    await storage.insert(sample("a1", "Tenant-1 street"));
    expect(await storage.findById("a1", "different-tenant")).toBeNull();
    // Same id resolves under its own tenant.
    expect((await storage.findById("a1", "t1"))?.street).toBe("Tenant-1 street");
  });

  it("list returns ONLY records matching the supplied tenantId — cross-tenant rows do not leak (iter-204)", async () => {
    const storage = new InMemoryAddressStorage();
    await storage.insert(sample("a1", "T1 street"));
    await storage.insert({ ...sample("a2", "T2 street"), tenantId: "t2" });
    const t1List = await storage.list("t1");
    const t2List = await storage.list("t2");
    expect(t1List.map((r) => r.id)).toEqual(["a1"]);
    expect(t2List.map((r) => r.id)).toEqual(["a2"]);
  });

  it("delete refuses to remove rows belonging to a different tenant (iter-204)", async () => {
    const storage = new InMemoryAddressStorage();
    await storage.insert(sample("a1"));
    expect(await storage.delete("a1", "different-tenant")).toBe(false);
    // Verify the row survives.
    expect((await storage.findById("a1", "t1"))?.id).toBe("a1");
  });
});

describe("Story · PrismaAddressStorage delegates to prisma.address (iter-169)", () => {
  function sample(id: string, overrides: Record<string, unknown> = {}) {
    return {
      id,
      tenantId: "t1",
      street: "S 1",
      zip: "12345",
      city: "Berlin",
      country: "DE",
      ...overrides,
    };
  }

  function fakePrisma(): {
    prisma: PrismaService;
    captured: { create: unknown[]; delete: unknown[] };
  } {
    const captured = { create: [] as unknown[], delete: [] as unknown[] };
    const rows = new Map<string, Record<string, unknown>>();
    const fake = {
      address: {
        async create(input: { data: Record<string, unknown> }) {
          captured.create.push(input.data);
          rows.set(String(input.data["id"]), input.data);
          return input.data;
        },
        async findFirst(input: { where: { id?: string; tenantId?: string } }) {
          const found = [...rows.values()].find(
            (r) =>
              (input.where.id === undefined || r["id"] === input.where.id) &&
              (input.where.tenantId === undefined || r["tenantId"] === input.where.tenantId),
          );
          return found ?? null;
        },
        async findMany(input: { where: { tenantId: string } }) {
          return [...rows.values()].filter((r) => r["tenantId"] === input.where.tenantId);
        },
        async deleteMany(input: { where: { id: string; tenantId: string } }) {
          captured.delete.push(input.where);
          const target = rows.get(input.where.id);
          if (!target || target["tenantId"] !== input.where.tenantId) {
            return { count: 0 };
          }
          rows.delete(input.where.id);
          return { count: 1 };
        },
      },
    };
    return { prisma: fake as unknown as PrismaService, captured };
  }

  it("insert calls prisma.address.create with row-shaped data", async () => {
    const { prisma, captured } = fakePrisma();
    const storage = new PrismaAddressStorage(prisma);
    await storage.insert(sample("a1"));
    expect(captured.create).toHaveLength(1);
    const data = captured.create[0] as Record<string, unknown>;
    expect(data["id"]).toBe("a1");
    expect(data["street"]).toBe("S 1");
    expect(data["tenantId"]).toBe("t1");
  });

  it("findById returns the mapped record, drops null-valued optional fields", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaAddressStorage(prisma);
    await storage.insert(sample("a1"));
    const r = (await storage.findById("a1", "t1"))!;
    expect(r.id).toBe("a1");
    expect(r.tenantId).toBe("t1");
    expect(r.street).toBe("S 1");
    // Optional fields default to undefined when the row has null values.
    expect((r as Record<string, unknown>)["state"]).toBeUndefined();
    expect((r as Record<string, unknown>)["formattedAddress"]).toBeUndefined();
  });

  it("findById preserves provided optional fields (formattedAddress, state, geocoded metadata)", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaAddressStorage(prisma);
    const enriched = sample("a1", {
      state: "Berlin",
      formattedAddress: "Hauptstraße 1, 10115 Berlin, DE",
      geocodingProvider: "nominatim",
      geocodedAt: new Date("2026-05-05T12:00:00Z"),
      metadata: { place_id: "x", confidence: 0.9 },
      ownedBy: "u1",
    });
    await storage.insert(enriched);
    const r = (await storage.findById("a1", "t1"))!;
    expect(r["state"]).toBe("Berlin");
    expect(r["formattedAddress"]).toBe("Hauptstraße 1, 10115 Berlin, DE");
    expect(r["geocodingProvider"]).toBe("nominatim");
    expect(r["geocodedAt"]).toBeInstanceOf(Date);
    expect((r["metadata"] as { place_id: string }).place_id).toBe("x");
    expect(r["ownedBy"]).toBe("u1");
  });

  it("list returns rows from prisma.address.findMany filtered by tenantId", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaAddressStorage(prisma);
    await storage.insert(sample("a1"));
    await storage.insert(sample("a2"));
    const all = await storage.list("t1");
    expect(all.map((r) => r.id).sort()).toEqual(["a1", "a2"]);
  });

  it("delete returns true on success, false when no row matches the (id, tenantId) pair", async () => {
    const { prisma, captured } = fakePrisma();
    const storage = new PrismaAddressStorage(prisma);
    await storage.insert(sample("a1"));
    expect(await storage.delete("a1", "t1")).toBe(true);
    expect(captured.delete).toEqual([{ id: "a1", tenantId: "t1" }]);
    // Second delete returns count=0 → false.
    expect(await storage.delete("a1", "t1")).toBe(false);
  });

  it("findById returns null when no row matches the (id, tenantId) pair", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaAddressStorage(prisma);
    expect(await storage.findById("missing", "t1")).toBeNull();
  });

  it("findById refuses cross-tenant probes — returns null when tenantId mismatches stored row (iter-204)", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaAddressStorage(prisma);
    await storage.insert(sample("a1"));
    // Probing under a different tenantId returns null instead of leaking.
    expect(await storage.findById("a1", "different-tenant")).toBeNull();
    // Same id resolves under its own tenant.
    expect((await storage.findById("a1", "t1"))?.id).toBe("a1");
  });

  it("delete refuses cross-tenant removal (iter-204)", async () => {
    const { prisma } = fakePrisma();
    const storage = new PrismaAddressStorage(prisma);
    await storage.insert(sample("a1"));
    expect(await storage.delete("a1", "different-tenant")).toBe(false);
    // Row survives.
    expect((await storage.findById("a1", "t1"))?.id).toBe("a1");
  });
});
