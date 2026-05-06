import { Injectable } from "@nestjs/common";

import type { PrismaService } from "../prisma/prisma.service.js";

/**
 * PowerSync persistence layer (CF.PS.04 closure — iter-216).
 *
 * The CRUD upload endpoint applies a batch of mobile-client mutations
 * keyed by `(type, id)` with an arbitrary JSON payload. Iter-pre-216
 * shipped a private `Map<string, StoreRow>` on the controller — every
 * offline-queued mutation lost on process restart.
 *
 * Iter-216 introduces this `PowerSyncStore` abstraction so the
 * controller persists each batch through:
 *   - `seed(tenantId, types)` — load every existing row for the
 *     batch's distinct `type` values into an in-memory Map.
 *   - run the existing pure conflict resolver (`applyPowerSyncCrudBatch`)
 *     against the Map.
 *   - `persist(tenantId, mutations)` — write the resulting Map back
 *     to the durable store in a single transaction.
 *
 * This keeps the conflict-resolver pure-function semantics intact
 * while making the storage durable.
 */
export interface PowerSyncRowSnapshot {
  type: string;
  id: string;
  data: Record<string, unknown>;
  updatedAt: Date;
}

export interface PowerSyncStore {
  /**
   * Load every persisted row for `tenantId` whose type is in `types`.
   * Returns the rows so the caller can hydrate its in-memory Map.
   */
  loadByTypes(tenantId: string, types: ReadonlyArray<string>): Promise<PowerSyncRowSnapshot[]>;

  /**
   * Apply a batch of upserts + deletes for `tenantId`.
   *   - `upserts`: rows the conflict resolver decided to keep.
   *   - `deletes`: `(type, id)` pairs the batch removed.
   */
  applyMutations(
    tenantId: string,
    upserts: ReadonlyArray<PowerSyncRowSnapshot>,
    deletes: ReadonlyArray<{ type: string; id: string }>,
  ): Promise<void>;
}

export const POWER_SYNC_STORE = Symbol.for("lt:PowerSyncStore");

/**
 * In-memory adapter — used by stories + tests + as a fallback when
 * the geo / powersync feature isn't loaded. Behaviourally identical
 * to the iter-pre-216 controller-private Map but exposed as a proper
 * adapter so the controller stays storage-agnostic.
 */
export class InMemoryPowerSyncStore implements PowerSyncStore {
  private readonly rows = new Map<string, PowerSyncRowSnapshot & { tenantId: string }>();

  async loadByTypes(
    tenantId: string,
    types: ReadonlyArray<string>,
  ): Promise<PowerSyncRowSnapshot[]> {
    const set = new Set(types);
    return [...this.rows.values()]
      .filter((r) => r.tenantId === tenantId && set.has(r.type))
      .map(({ tenantId: _t, ...rest }) => rest);
  }

  async applyMutations(
    tenantId: string,
    upserts: ReadonlyArray<PowerSyncRowSnapshot>,
    deletes: ReadonlyArray<{ type: string; id: string }>,
  ): Promise<void> {
    for (const u of upserts) {
      this.rows.set(`${tenantId}:${u.type}:${u.id}`, { tenantId, ...u });
    }
    for (const d of deletes) {
      this.rows.delete(`${tenantId}:${d.type}:${d.id}`);
    }
  }

  /** Test-only: wipe the store between runs. */
  reset(): void {
    this.rows.clear();
  }
}

/**
 * Type-erasing slice of the Prisma client. The `powerSyncRow`
 * delegate is only available when the `powersync` feature schema is
 * loaded; consumers without the feature use `InMemoryPowerSyncStore`.
 */
interface PrismaPowerSyncDelegate {
  findMany(input: {
    where: { tenantId: string; type: { in: ReadonlyArray<string> } };
  }): Promise<
    Array<{ type: string; id: string; data: unknown; updatedAt: Date; tenantId: string }>
  >;
  upsert(input: {
    where: { tenantId_type_id: { tenantId: string; type: string; id: string } };
    create: { tenantId: string; type: string; id: string; data: unknown };
    update: { data: unknown };
  }): Promise<unknown>;
  deleteMany(input: {
    where: { tenantId: string; type: string; id: string };
  }): Promise<{ count: number }>;
}

interface PrismaPowerSyncClient {
  powerSyncRow: PrismaPowerSyncDelegate;
}

/**
 * Prisma-backed adapter. Loads rows for the batch's tenant + types
 * via a single `findMany`, then writes back via per-row upserts +
 * deletes inside a `$transaction` for atomicity.
 */
@Injectable()
export class PrismaPowerSyncStore implements PowerSyncStore {
  constructor(private readonly prisma: PrismaService) {}

  async loadByTypes(
    tenantId: string,
    types: ReadonlyArray<string>,
  ): Promise<PowerSyncRowSnapshot[]> {
    if (types.length === 0) return [];
    const rows = await this.client().powerSyncRow.findMany({
      where: { tenantId, type: { in: types } },
    });
    return rows.map((r) => ({
      type: r.type,
      id: r.id,
      data: r.data as Record<string, unknown>,
      updatedAt: r.updatedAt,
    }));
  }

  async applyMutations(
    tenantId: string,
    upserts: ReadonlyArray<PowerSyncRowSnapshot>,
    deletes: ReadonlyArray<{ type: string; id: string }>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const erasedTx: unknown = tx;
      const erased = erasedTx as { powerSyncRow: PrismaPowerSyncDelegate };
      for (const u of upserts) {
        await erased.powerSyncRow.upsert({
          where: { tenantId_type_id: { tenantId, type: u.type, id: u.id } },
          create: { tenantId, type: u.type, id: u.id, data: u.data },
          update: { data: u.data },
        });
      }
      for (const d of deletes) {
        await erased.powerSyncRow.deleteMany({
          where: { tenantId, type: d.type, id: d.id },
        });
      }
    });
  }

  private client(): PrismaPowerSyncClient {
    const erased: unknown = this.prisma;
    return erased as PrismaPowerSyncClient;
  }
}
