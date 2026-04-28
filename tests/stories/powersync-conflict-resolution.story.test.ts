import { describe, expect, it } from 'vitest';

import {
  resolvePowerSyncConflict,
  type PowerSyncConflictDecision,
} from '../../src/core/repository/powersync-conflict.js';

/**
 * Story · PowerSync conflict-resolution hook (PLAN.md §15.5 + §32 Phase 5b).
 *
 * When the upload-controller replays an offline mutation, the row may
 * already have moved on (a different client wrote first, or the
 * server-side Job did). The resolver decides what happens:
 *
 *   - last-write-wins (default for PUT/PATCH on simple value fields)
 *   - server-wins (any write to an admin-controlled field is rejected)
 *   - merge (per-field combine if the model declares a strategy)
 *
 * Concretely:
 *   - clientUpdatedAt vs serverUpdatedAt picks the winner
 *   - protectedFields (e.g. `role`, `verifiedAt`) always force server-wins
 *   - the resolver returns a *decision*, never a write — the runner
 *     applies (or rejects with 409) based on the decision.
 */
describe('Story · PowerSync conflict resolution', () => {
  it('client wins when its updatedAt is newer than the server row', () => {
    const decision = resolvePowerSyncConflict({
      clientPatch: { name: 'fromClient' },
      clientUpdatedAt: new Date('2026-01-02T00:00:00Z'),
      serverRow: { id: 'a', name: 'fromServer', updatedAt: new Date('2026-01-01T00:00:00Z') },
      protectedFields: [],
    });
    expect(decision.outcome).toBe('client-wins');
    expect(decision.merged.name).toBe('fromClient');
  });

  it('server wins when the server updatedAt is newer (last-write-wins)', () => {
    const decision = resolvePowerSyncConflict({
      clientPatch: { name: 'stale' },
      clientUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      serverRow: { id: 'a', name: 'fresh', updatedAt: new Date('2026-01-02T00:00:00Z') },
      protectedFields: [],
    });
    expect(decision.outcome).toBe('server-wins');
    expect(decision.merged.name).toBe('fresh');
  });

  it('protected fields are never overwritten by the client (privilege escalation guard)', () => {
    const decision = resolvePowerSyncConflict({
      clientPatch: { name: 'ok', role: 'ADMIN' },
      clientUpdatedAt: new Date('2026-12-31T00:00:00Z'),
      serverRow: { id: 'a', name: 'old', role: 'USER', updatedAt: new Date('2026-01-01T00:00:00Z') },
      protectedFields: ['role'],
    });
    // Even though clientUpdatedAt > serverUpdatedAt, role is locked.
    expect(decision.merged.role).toBe('USER');
    // Conflict status is reported even though the rest of the patch lands.
    expect(decision.outcome).toBe('partial-conflict');
  });

  it('returns the unchanged server row when the client patch is empty', () => {
    const decision = resolvePowerSyncConflict({
      clientPatch: {},
      clientUpdatedAt: new Date('2026-01-02T00:00:00Z'),
      serverRow: { id: 'a', name: 'fresh', updatedAt: new Date('2026-01-01T00:00:00Z') },
      protectedFields: [],
    });
    expect(decision.outcome).toBe('no-op');
    expect(decision.merged.name).toBe('fresh');
  });

  it('decision shape is statically typed (PowerSyncConflictDecision)', () => {
    const decision = resolvePowerSyncConflict({
      clientPatch: { name: 'x' },
      clientUpdatedAt: new Date(),
      serverRow: { id: 'a', name: 'y', updatedAt: new Date() },
      protectedFields: [],
    });
    const _typed: PowerSyncConflictDecision<{ id: string; name: string; updatedAt: Date }> = decision;
    void _typed;
  });
});
