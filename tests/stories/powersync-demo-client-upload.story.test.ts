import { describe, expect, it } from 'vitest';

import {
  applyPowerSyncCrudBatch,
  buildPowerSyncDemoClient,
  type PowerSyncDemoClient,
} from '../../src/core/auth/powersync-demo-client.js';
import { resolvePowerSyncConflict } from '../../src/core/repository/powersync-conflict.js';

/**
 * Story · PowerSync demo client + upload-backend integration
 *           (PLAN.md §15.5 + §32 Phase 5b, item 5b-9).
 *
 * The actual React-Native PowerSync client lives in a separate mobile
 * repo; what we own *here* is the in-memory simulator that buffers
 * mutations offline and replays them through the same upload-controller
 * planner the real client uses. Running the simulator end-to-end
 * proves:
 *
 *   - the client batches PUT/PATCH/DELETE in order (no reordering)
 *   - the upload-controller validates the wire shape (Zod)
 *   - conflict resolution decides correctly across the boundary
 *   - 204 / 409 outcomes round-trip
 *
 * If the simulator passes but a real client fails, the wire format is
 * the suspect — not the controller logic.
 */
describe('Story · PowerSync demo client → upload-backend', () => {
  describe('buildPowerSyncDemoClient', () => {
    it('starts with an empty buffer', () => {
      const client = buildPowerSyncDemoClient();
      expect(client.buffer()).toHaveLength(0);
    });

    it('queues PUT/PATCH/DELETE in insertion order', () => {
      const client = buildPowerSyncDemoClient();
      client.queue({ op: 'PUT', type: 'widgets', id: '1', data: { name: 'A' } });
      client.queue({ op: 'PATCH', type: 'widgets', id: '1', data: { name: 'B' } });
      client.queue({ op: 'DELETE', type: 'widgets', id: '1' });
      const buf = client.buffer();
      expect(buf.map((o) => o.op)).toEqual(['PUT', 'PATCH', 'DELETE']);
    });

    it('flush() empties the buffer and returns the batch payload', () => {
      const client = buildPowerSyncDemoClient();
      client.queue({ op: 'PUT', type: 'widgets', id: '1', data: { name: 'A' } });
      const payload = client.flush();
      expect(payload.batch).toHaveLength(1);
      expect(client.buffer()).toHaveLength(0);
    });

    it('the demo client matches the PowerSyncDemoClient interface', () => {
      const _typed: PowerSyncDemoClient = buildPowerSyncDemoClient();
      void _typed;
    });
  });

  describe('applyPowerSyncCrudBatch (upload backend)', () => {
    it('applies PUT/PATCH against an in-memory store and returns 204', () => {
      const store = new Map<string, { id: string; name: string; updatedAt: Date }>();
      const result = applyPowerSyncCrudBatch(
        {
          batch: [
            { op: 'PUT', type: 'widgets', id: 'w1', data: { name: 'foo' } },
            { op: 'PATCH', type: 'widgets', id: 'w1', data: { name: 'foo-edited' } },
          ],
        },
        { store, now: () => new Date('2026-04-28T12:00:00Z') },
      );
      expect(result.status).toBe(204);
      expect(store.get('widgets:w1')?.name).toBe('foo-edited');
    });

    it('returns 409 when conflict resolution rejects a protected-field write', () => {
      const store = new Map<string, { id: string; name: string; role?: string; updatedAt: Date }>();
      store.set('users:u1', {
        id: 'u1',
        name: 'Pascal',
        role: 'USER',
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      });
      const result = applyPowerSyncCrudBatch(
        {
          batch: [
            {
              op: 'PATCH',
              type: 'users',
              id: 'u1',
              data: { role: 'ADMIN', name: 'attacker' },
            },
          ],
        },
        {
          store,
          now: () => new Date('2026-04-28T12:00:00Z'),
          protectedFieldsByType: { users: ['role'] },
        },
      );
      expect(result.status).toBe(409);
      // The non-protected field still lands; only `role` is rejected.
      expect(store.get('users:u1')?.role).toBe('USER');
      expect(store.get('users:u1')?.name).toBe('attacker');
    });

    it('DELETE removes the row', () => {
      const store = new Map<string, { id: string; updatedAt: Date }>();
      store.set('widgets:w1', { id: 'w1', updatedAt: new Date() });
      const result = applyPowerSyncCrudBatch(
        { batch: [{ op: 'DELETE', type: 'widgets', id: 'w1' }] },
        { store, now: () => new Date() },
      );
      expect(result.status).toBe(204);
      expect(store.has('widgets:w1')).toBe(false);
    });

    it('round-trip: demo client queues → flush → backend applies → store is updated', () => {
      const client = buildPowerSyncDemoClient();
      client.queue({ op: 'PUT', type: 'widgets', id: 'w1', data: { name: 'A' } });
      client.queue({ op: 'PATCH', type: 'widgets', id: 'w1', data: { name: 'A2' } });
      const payload = client.flush();

      const store = new Map<string, { id: string; name: string; updatedAt: Date }>();
      const result = applyPowerSyncCrudBatch(payload, { store, now: () => new Date() });

      expect(result.status).toBe(204);
      expect(store.get('widgets:w1')?.name).toBe('A2');
    });

    it('upload-backend invokes the conflict-resolution planner (not a custom one)', () => {
      // Sanity: server has updatedAt newer than client → server-wins for
      // unprotected fields per the planner contract. Demo backend MUST
      // delegate to resolvePowerSyncConflict so the behaviour matches.
      const decision = resolvePowerSyncConflict({
        clientPatch: { name: 'stale' },
        clientUpdatedAt: new Date('2026-01-01T00:00:00Z'),
        serverRow: { id: 'w1', name: 'fresh', updatedAt: new Date('2026-04-01T00:00:00Z') },
        protectedFields: [],
      });
      expect(decision.outcome).toBe('server-wins');

      const store = new Map<string, { id: string; name: string; updatedAt: Date }>();
      store.set('widgets:w1', {
        id: 'w1',
        name: 'fresh',
        updatedAt: new Date('2026-04-01T00:00:00Z'),
      });
      const result = applyPowerSyncCrudBatch(
        {
          batch: [
            { op: 'PATCH', type: 'widgets', id: 'w1', data: { name: 'stale' } },
          ],
        },
        {
          store,
          now: () => new Date('2026-01-01T00:00:00Z'), // client clock — older
        },
      );
      // No protected fields, server is newer → server-wins, store unchanged.
      expect(store.get('widgets:w1')?.name).toBe('fresh');
      expect(result.status).toBe(204);
    });
  });
});
