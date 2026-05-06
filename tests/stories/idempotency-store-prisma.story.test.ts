import { describe, expect, it } from "vitest";

import { PrismaIdempotencyStore } from "../../src/core/idempotency/idempotency-store.prisma.js";
import type {
  IdempotencyRecord,
  IdempotencyStore,
} from "../../src/core/idempotency/idempotency.service.js";
import type { PrismaService } from "../../src/core/prisma/prisma.service.js";

/**
 * Story · `PrismaIdempotencyStore` (CF.STORAGE.01 closure — iter-179).
 *
 * The `IdempotencyRecord` Prisma model lives in `prisma/schema.prisma`;
 * this adapter persists Stripe-style idempotency records so replays
 * survive a process restart. The story drives the adapter against a
 * fake `prisma.idempotencyRecord` delegate so the mapping logic +
 * upsert semantics + cross-restart contract are locked without
 * spinning up Postgres.
 */
describe("Story · PrismaIdempotencyStore delegates to prisma.idempotencyRecord (iter-179)", () => {
  function fakePrisma(): {
    prisma: PrismaService;
    rows: Map<string, Record<string, unknown>>;
    captured: { upsert: unknown[]; delete: unknown[]; deleteMany: unknown[] };
  } {
    const rows = new Map<string, Record<string, unknown>>();
    const captured = {
      upsert: [] as unknown[],
      delete: [] as unknown[],
      deleteMany: [] as unknown[],
    };
    const fake = {
      idempotencyRecord: {
        async findUnique(input: { where: { key: string } }) {
          return rows.get(input.where.key) ?? null;
        },
        async upsert(input: {
          where: { key: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) {
          captured.upsert.push(input);
          const existing = rows.get(input.where.key);
          const next = existing ? { ...existing, ...input.update } : { ...input.create };
          rows.set(input.where.key, next);
          return next;
        },
        async delete(input: { where: { key: string } }) {
          captured.delete.push(input.where);
          if (!rows.has(input.where.key)) {
            throw new Error("Record to delete does not exist.");
          }
          const existing = rows.get(input.where.key)!;
          rows.delete(input.where.key);
          return existing;
        },
        async deleteMany(input: { where: { expiresAt: { lt: Date } } }) {
          captured.deleteMany.push(input);
          const cutoff = input.where.expiresAt.lt;
          let count = 0;
          for (const [key, row] of rows) {
            const expiresAt = row["expiresAt"] as Date | undefined;
            if (expiresAt && expiresAt < cutoff) {
              rows.delete(key);
              count += 1;
            }
          }
          return { count };
        },
      },
    };
    return { prisma: fake as unknown as PrismaService, rows, captured };
  }

  function sampleRecord(
    key: string,
    overrides: Partial<IdempotencyRecord> = {},
  ): IdempotencyRecord {
    return {
      key,
      userId: "u1",
      requestHash: `rh-${key}`,
      status: 201,
      body: { id: `result-${key}` },
      expiresAt: Date.UTC(2026, 4, 6),
      ...overrides,
    };
  }

  it("get returns null for an unknown key", async () => {
    const { prisma } = fakePrisma();
    const store: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    expect(await store.get("u1::missing")).toBeNull();
  });

  it("put + get round-trips the full record (status, body, expiresAt, requestHash)", async () => {
    const { prisma } = fakePrisma();
    const store: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    const record = sampleRecord("u1::k1", {
      status: 202,
      body: { ok: true, id: "abc" },
      expiresAt: Date.UTC(2026, 4, 7),
    });
    await store.put(record);
    const got = await store.get("u1::k1");
    expect(got).not.toBeNull();
    expect(got!.key).toBe("u1::k1");
    expect(got!.userId).toBe("u1");
    expect(got!.status).toBe(202);
    expect(got!.body).toEqual({ ok: true, id: "abc" });
    expect(got!.expiresAt).toBe(Date.UTC(2026, 4, 7));
    expect(got!.requestHash).toBe("rh-u1::k1");
  });

  it("put uses upsert so the second put replaces the first (refresh after expiry)", async () => {
    const { prisma, captured } = fakePrisma();
    const store: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    await store.put(sampleRecord("u1::k1", { status: 200, body: { v: 1 } }));
    await store.put(sampleRecord("u1::k1", { status: 201, body: { v: 2 } }));
    expect(captured.upsert).toHaveLength(2);
    const got = await store.get("u1::k1");
    expect(got!.status).toBe(201);
    expect(got!.body).toEqual({ v: 2 });
  });

  it("delete removes the row; subsequent get returns null", async () => {
    const { prisma } = fakePrisma();
    const store: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    await store.put(sampleRecord("u1::k1"));
    await store.delete("u1::k1");
    expect(await store.get("u1::k1")).toBeNull();
  });

  it("delete on a missing row swallows the error (best-effort cleanup)", async () => {
    const { prisma } = fakePrisma();
    const store: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    await expect(store.delete("u1::missing")).resolves.toBeUndefined();
  });

  it("expiresAt is persisted as a Date but read back as ms-epoch (ms↔Date boundary)", async () => {
    const { prisma, rows } = fakePrisma();
    const store: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    const expiresMs = Date.UTC(2026, 4, 8);
    await store.put(sampleRecord("u1::k1", { expiresAt: expiresMs }));
    // Persisted as Date in Prisma, ms on the service-facing record.
    const persisted = rows.get("u1::k1")!;
    expect(persisted["expiresAt"]).toBeInstanceOf(Date);
    expect((persisted["expiresAt"] as Date).getTime()).toBe(expiresMs);
    const got = await store.get("u1::k1");
    expect(got!.expiresAt).toBe(expiresMs);
  });

  it("anonymous (no userId) records round-trip with userId omitted on the read side", async () => {
    const { prisma } = fakePrisma();
    const store: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    const anon: IdempotencyRecord = {
      key: "anon::k1",
      requestHash: "rh-anon",
      status: 200,
      body: { ok: true },
      expiresAt: Date.UTC(2026, 4, 6),
    };
    await store.put(anon);
    const got = await store.get("anon::k1");
    expect(got!.userId).toBeUndefined();
    expect(got!.key).toBe("anon::k1");
  });

  it("body JSON is preserved verbatim — arrays, nested objects, nulls", async () => {
    const { prisma } = fakePrisma();
    const store: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    const complexBody = {
      items: [{ id: 1 }, { id: 2 }],
      meta: { total: 2, cursor: null },
      flags: ["a", "b", "c"],
    };
    await store.put(sampleRecord("u1::k1", { body: complexBody }));
    const got = await store.get("u1::k1");
    expect(got!.body).toEqual(complexBody);
  });

  it("deleteOlderThan delegates to prisma.deleteMany with `expiresAt: { lt: Date }` and returns the count", async () => {
    const { prisma, captured } = fakePrisma();
    const store = new PrismaIdempotencyStore(prisma);
    const now = Date.UTC(2026, 4, 6, 12, 0, 0);
    await store.put(sampleRecord("u1::expired-1", { expiresAt: now - 60_000 }));
    await store.put(sampleRecord("u1::expired-2", { expiresAt: now - 1 }));
    await store.put(sampleRecord("u1::live", { expiresAt: now + 60_000 }));

    const deleted = await store.deleteOlderThan(now);
    expect(deleted).toBe(2);
    expect(captured.deleteMany).toHaveLength(1);
    const call = captured.deleteMany[0] as { where: { expiresAt: { lt: Date } } };
    expect(call.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(call.where.expiresAt.lt.getTime()).toBe(now);
    expect(await store.get("u1::expired-1")).toBeNull();
    expect(await store.get("u1::expired-2")).toBeNull();
    expect(await store.get("u1::live")).not.toBeNull();
  });

  it("cross-restart contract — second store instance reading the same prisma sees prior puts", async () => {
    // Two `PrismaIdempotencyStore` instances over the SAME prisma
    // delegate emulate a process restart: the in-memory cache is gone
    // but the persisted row survives. This is the load-bearing
    // property the migration delivers.
    const { prisma } = fakePrisma();
    const writer: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    await writer.put(sampleRecord("u1::cross-restart"));
    const reader: IdempotencyStore = new PrismaIdempotencyStore(prisma);
    const got = await reader.get("u1::cross-restart");
    expect(got).not.toBeNull();
    expect(got!.key).toBe("u1::cross-restart");
  });
});
