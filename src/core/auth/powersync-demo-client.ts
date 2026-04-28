import { resolvePowerSyncConflict } from '../repository/powersync-conflict.js';

import {
  parsePowerSyncCrudBatch,
  type PowerSyncCrudBatch,
  type PowerSyncCrudOperation,
} from './powersync-upload.js';

/**
 * PowerSync demo client + in-memory upload backend
 *   (PLAN.md §15.5 + §32 Phase 5b, item 5b-9).
 *
 * The mobile RN client lives in another repo. Here we ship:
 *
 *   - `buildPowerSyncDemoClient()` — a pure in-memory queue that
 *     mirrors the wire shape of the real client. Queue → flush →
 *     produces the exact `{ batch: [...] }` payload the real client
 *     POSTs to /powersync/crud.
 *   - `applyPowerSyncCrudBatch()` — the backend-side replay that the
 *     upload-controller uses. Validates with the upload schema, then
 *     applies via the conflict-resolution planner against an
 *     in-memory `Map<string, T>` store keyed by `${type}:${id}`.
 *
 * Both pieces are pure (no Postgres, no fetch) so they round-trip in
 * vitest without any infrastructure.  The real controller swaps the
 * Map for a Repository call and the resolver behaviour is identical.
 */

export interface PowerSyncDemoClient {
  queue(op: PowerSyncCrudOperation): void;
  buffer(): ReadonlyArray<PowerSyncCrudOperation>;
  flush(): PowerSyncCrudBatch;
}

export function buildPowerSyncDemoClient(): PowerSyncDemoClient {
  let pending: PowerSyncCrudOperation[] = [];
  return {
    queue(op) {
      pending.push(op);
    },
    buffer() {
      return [...pending];
    },
    flush() {
      const batch = pending;
      pending = [];
      return { batch };
    },
  };
}

interface StoreRow {
  id: string;
  updatedAt: Date;
  [key: string]: unknown;
}

export interface ApplyPowerSyncBatchOptions {
  store: Map<string, StoreRow>;
  now: () => Date;
  protectedFieldsByType?: Record<string, ReadonlyArray<string>>;
}

export interface ApplyPowerSyncBatchResult {
  status: 204 | 409;
  rejected: Array<{ id: string; type: string; fields: string[] }>;
}

export function applyPowerSyncCrudBatch(
  batch: unknown,
  options: ApplyPowerSyncBatchOptions,
): ApplyPowerSyncBatchResult {
  const parsed = parsePowerSyncCrudBatch(batch);
  const protectedByType = options.protectedFieldsByType ?? {};
  const rejected: ApplyPowerSyncBatchResult['rejected'] = [];

  for (const op of parsed.batch) {
    const key = `${op.type}:${op.id}`;
    if (op.op === 'DELETE') {
      options.store.delete(key);
      continue;
    }
    const protectedFields = (protectedByType[op.type] ?? []) as ReadonlyArray<string>;
    const existing = options.store.get(key);
    if (!existing) {
      // Fresh insert — no conflict possible.
      options.store.set(key, {
        id: op.id,
        updatedAt: options.now(),
        ...op.data,
      });
      continue;
    }
    const decision = resolvePowerSyncConflict<StoreRow>({
      clientPatch: (op.data ?? {}) as Partial<StoreRow>,
      clientUpdatedAt: options.now(),
      serverRow: existing,
      protectedFields: protectedFields as ReadonlyArray<keyof StoreRow & string>,
    });
    if (decision.outcome === 'partial-conflict') {
      rejected.push({ id: op.id, type: op.type, fields: decision.rejectedFields });
    }
    options.store.set(key, { ...decision.merged, updatedAt: options.now() });
  }

  return { status: rejected.length === 0 ? 204 : 409, rejected };
}
