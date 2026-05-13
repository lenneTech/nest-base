import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Optional,
  Post,
} from "@nestjs/common";

import { Can } from "../permissions/can.guard.js";

import { applyPowerSyncCrudBatch } from "./powersync-demo-client.js";
import {
  InMemoryPowerSyncStore,
  POWER_SYNC_STORE,
  type PowerSyncRowSnapshot,
  type PowerSyncStore,
} from "./powersync-store.js";
import { parsePowerSyncCrudBatch, type PowerSyncCrudBatch } from "./powersync-upload.js";

interface StoreRow {
  id: string;
  updatedAt: Date;
  [key: string]: unknown;
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireTenantHeader(tenantHeader: string | undefined): string {
  const tenantId = tenantHeader?.trim() ?? "";
  if (tenantId.length === 0) {
    throw new BadRequestException("x-tenant-id header is required");
  }
  if (!UUID_PATTERN.test(tenantId)) {
    throw new BadRequestException("x-tenant-id header must be a valid UUID");
  }
  return tenantId;
}

/**
 * `POST /powersync/crud` — receives the offline-queued mutation
 * batch from the PowerSync mobile client and applies it.
 *
 * Iter-216 CF.PS.04 closure: persistence now flows through the
 * `PowerSyncStore` adapter (Prisma-backed `power_sync_rows` table by
 * default). Process restart no longer drops offline-queued mutations.
 * Each batch:
 *   1. Reads the operator's tenant from the `x-tenant-id` header.
 *   2. Loads the existing rows for the batch's distinct types into
 *      an in-memory Map (the conflict resolver's input shape).
 *   3. Runs the existing pure `applyPowerSyncCrudBatch` resolver.
 *   4. Persists the resulting Map back to the durable store in a
 *      single transaction.
 *
 * Domain modules can override the binding via the `POWER_SYNC_STORE`
 * token to provide a per-resource adapter.
 */
@Controller("powersync")
export class PowerSyncController {
  private readonly fallback: PowerSyncStore;
  private readonly store: PowerSyncStore;

  constructor(@Optional() @Inject(POWER_SYNC_STORE) injected?: PowerSyncStore) {
    this.fallback = new InMemoryPowerSyncStore();
    this.store = injected ?? this.fallback;
  }

  @Can("write", "PowerSync")
  @Post("crud")
  @HttpCode(HttpStatus.NO_CONTENT)
  async crud(
    @Headers("x-tenant-id") tenantHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<{ rejected?: unknown[] }> {
    const tenantId = requireTenantHeader(tenantHeader);
    let batch: PowerSyncCrudBatch;
    try {
      batch = parsePowerSyncCrudBatch(body);
    } catch {
      // Internal parse-error details must not reach the client — they
      // may expose token structure or schema shape information.
      throw new BadRequestException("invalid CRUD batch");
    }

    // 1. Hydrate the in-memory Map from the durable store. Only the
    //    types touched by this batch need to load.
    const types = [...new Set(batch.batch.map((op) => op.type))];
    const existing = await this.store.loadByTypes(tenantId, types);
    const map = new Map<string, StoreRow>();
    for (const row of existing) {
      map.set(`${row.type}:${row.id}`, {
        id: row.id,
        updatedAt: row.updatedAt,
        ...row.data,
      });
    }

    // 2. Run the pure conflict-resolver against the Map.
    const result = applyPowerSyncCrudBatch(batch, { store: map, now: () => new Date() });

    // 3. Diff Map ↔ original to compute upserts + deletes, then
    //    persist atomically.
    const upserts: PowerSyncRowSnapshot[] = [];
    const deletes: Array<{ type: string; id: string }> = [];
    for (const op of batch.batch) {
      const key = `${op.type}:${op.id}`;
      const after = map.get(key);
      if (after) {
        const { id, updatedAt, ...payload } = after;
        upserts.push({ type: op.type, id, data: payload, updatedAt });
      } else {
        deletes.push({ type: op.type, id: op.id });
      }
    }
    await this.store.applyMutations(tenantId, upserts, deletes);

    if (result.status === 409) {
      // 409 status is returned by the framework throwing — the controller
      // surfaces the rejected fields so the client knows what to retry.
      const conflictBody = { rejected: result.rejected };
      throw new BadRequestException(conflictBody);
    }
    return {};
  }
}
