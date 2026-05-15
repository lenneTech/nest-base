/**
 * PowerSync conflict-resolution planner.
 *
 * Pure decision function. Given a client patch with its claimed
 * updatedAt + the current server row + the model's protected-field
 * list, produces a single decision the upload-controller can act on:
 *
 *   - 'client-wins'      — apply patch as-is
 *   - 'server-wins'      — discard patch, return the server row
 *   - 'partial-conflict' — apply non-protected fields, keep server values
 *                          for protected ones (controller emits 409)
 *   - 'no-op'            — patch is empty
 *
 * Deliberately *not* coupled to BaseRepository — the resolver is a
 * pure function so it can be reused by any uploader (REST, GraphQL,
 * batch import) without hauling Prisma into the test surface.
 */

export type PowerSyncConflictOutcome = "client-wins" | "server-wins" | "partial-conflict" | "no-op";

export interface PowerSyncConflictDecision<T extends { updatedAt?: Date }> {
  outcome: PowerSyncConflictOutcome;
  merged: T;
  rejectedFields: string[];
}

export interface ResolvePowerSyncConflictInput<T extends { updatedAt?: Date }> {
  clientPatch: Partial<T>;
  clientUpdatedAt: Date;
  serverRow: T;
  protectedFields: ReadonlyArray<keyof T & string>;
}

export function resolvePowerSyncConflict<T extends { updatedAt?: Date }>(
  input: ResolvePowerSyncConflictInput<T>,
): PowerSyncConflictDecision<T> {
  const { clientPatch, clientUpdatedAt, serverRow, protectedFields } = input;

  const patchKeys = Object.keys(clientPatch) as Array<keyof T & string>;
  if (patchKeys.length === 0) {
    return { outcome: "no-op", merged: serverRow, rejectedFields: [] };
  }

  const protectedSet = new Set(protectedFields);
  const rejectedFields = patchKeys.filter((k) => protectedSet.has(k));

  const serverNewer = serverRow.updatedAt instanceof Date && serverRow.updatedAt > clientUpdatedAt;

  if (serverNewer) {
    // Server is ahead: discard the entire stale client patch regardless
    // of whether protected fields are touched. Applying non-protected
    // fields from a stale client would silently overwrite fresher server
    // state. The caller receives `rejectedFields` so it can surface a
    // 409 to the client with context about what was not applied.
    return { outcome: "server-wins", merged: serverRow, rejectedFields };
  }

  // Client is at least as fresh as the server — apply the patch.
  // Protected fields are never overwritten (privilege escalation guard).
  const merged: T = { ...serverRow };
  for (const key of patchKeys) {
    if (protectedSet.has(key)) continue;
    (merged as Record<string, unknown>)[key] = (clientPatch as Record<string, unknown>)[key];
  }

  if (rejectedFields.length > 0) {
    return { outcome: "partial-conflict", merged, rejectedFields };
  }
  return { outcome: "client-wins", merged, rejectedFields: [] };
}
