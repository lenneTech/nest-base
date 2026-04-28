import { z } from 'zod';

/**
 * PowerSync upload-controller planner (PLAN.md §15.5 + §32 Phase 5b).
 *
 * The PowerSync client buffers offline mutations as a batch of CRUD
 * operations and POSTs them to `/powersync/crud` once back online.
 * This module owns the wire-shape validation + endpoint metadata; the
 * runtime controller (in src/modules/) wraps it with the actual
 * Repository writes.
 *
 * Why a planner: the validator runs in unit tests without booting
 * Postgres, and the metadata feeds the AppModule's route table so the
 * JWT middleware knows the path requires `audience: powersync`.
 */

const MAX_BATCH_SIZE = 1000;

const PutOrPatchSchema = z.object({
  op: z.enum(['PUT', 'PATCH']),
  type: z.string().min(1),
  id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

const DeleteSchema = z.object({
  op: z.literal('DELETE'),
  type: z.string().min(1),
  id: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

const PowerSyncCrudOperationSchema = z.union([PutOrPatchSchema, DeleteSchema]);

const PowerSyncCrudBatchSchema = z.object({
  batch: z.array(PowerSyncCrudOperationSchema).max(MAX_BATCH_SIZE),
});

export type PowerSyncCrudOperation = z.infer<typeof PowerSyncCrudOperationSchema>;
export type PowerSyncCrudBatch = z.infer<typeof PowerSyncCrudBatchSchema>;

export interface PowerSyncCrudEndpoint {
  method: 'POST';
  path: '/powersync/crud';
  public: false;
  successStatus: 204;
  conflictStatus: 409;
}

export function parsePowerSyncCrudBatch(input: unknown): PowerSyncCrudBatch {
  return PowerSyncCrudBatchSchema.parse(input);
}

export function describePowerSyncCrudEndpoint(): PowerSyncCrudEndpoint {
  return {
    method: 'POST',
    path: '/powersync/crud',
    public: false,
    successStatus: 204,
    conflictStatus: 409,
  };
}
