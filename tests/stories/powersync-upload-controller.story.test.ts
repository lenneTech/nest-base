import { describe, expect, it } from 'vitest';

import {
  parsePowerSyncCrudBatch,
  describePowerSyncCrudEndpoint,
  type PowerSyncCrudOperation,
} from '../../src/core/auth/powersync-upload.js';

/**
 * Story · PowerSync /powersync/crud upload controller (PLAN.md §15.5 + Phase 5b).
 *
 * The PowerSync client buffers offline mutations as a batch of CRUD
 * operations and POSTs them to `/powersync/crud` once back online.
 * Each entry is a `{ op, type, id, data }` quad.  The controller:
 *
 *   - validates the batch shape (Zod)
 *   - applies operations IN ORDER (so a delete-after-update doesn't
 *     resurrect the row)
 *   - returns `204 No Content` on full success, or a 409 with the
 *     conflicting op id when conflict resolution falls back to
 *     "server wins"
 *
 * Tests below pin the planner — the controller wraps it.
 */
describe('Story · PowerSync /powersync/crud upload', () => {
  describe('parsePowerSyncCrudBatch', () => {
    it('accepts a well-formed batch', () => {
      const batch = parsePowerSyncCrudBatch({
        batch: [
          { op: 'PUT', type: 'widgets', id: '11111111-1111-7111-8111-111111111111', data: { name: 'foo' } },
          { op: 'PATCH', type: 'widgets', id: '11111111-1111-7111-8111-111111111111', data: { name: 'bar' } },
          { op: 'DELETE', type: 'widgets', id: '11111111-1111-7111-8111-111111111111' },
        ],
      });
      expect(batch.batch).toHaveLength(3);
      expect(batch.batch[0]?.op).toBe('PUT');
    });

    it('rejects an op with an unknown verb', () => {
      expect(() =>
        parsePowerSyncCrudBatch({
          batch: [{ op: 'NUKE' as 'PUT', type: 't', id: 'x', data: {} }],
        }),
      ).toThrow();
    });

    it('rejects an empty type (would let a client write to an arbitrary table name)', () => {
      expect(() =>
        parsePowerSyncCrudBatch({ batch: [{ op: 'PUT', type: '', id: 'x', data: {} }] }),
      ).toThrow();
    });

    it('rejects PUT/PATCH without a data payload', () => {
      expect(() =>
        parsePowerSyncCrudBatch({
          batch: [{ op: 'PUT', type: 'widgets', id: 'x' } as unknown as PowerSyncCrudOperation],
        }),
      ).toThrow();
    });

    it('preserves order (planner is order-sensitive — server replays exactly)', () => {
      const result = parsePowerSyncCrudBatch({
        batch: [
          { op: 'PUT', type: 'a', id: '1', data: { v: 1 } },
          { op: 'PUT', type: 'b', id: '2', data: { v: 2 } },
          { op: 'PUT', type: 'c', id: '3', data: { v: 3 } },
        ],
      });
      expect(result.batch.map((o) => o.type)).toEqual(['a', 'b', 'c']);
    });

    it('clamps batch size to a sane upper bound (DoS guard)', () => {
      const huge = Array.from({ length: 10001 }, (_, i) => ({
        op: 'PUT' as const,
        type: 'widgets',
        id: String(i),
        data: { i },
      }));
      expect(() => parsePowerSyncCrudBatch({ batch: huge })).toThrow();
    });
  });

  describe('describePowerSyncCrudEndpoint', () => {
    it('is POST /powersync/crud', () => {
      const meta = describePowerSyncCrudEndpoint();
      expect(meta.method).toBe('POST');
      expect(meta.path).toBe('/powersync/crud');
    });

    it('requires authentication (the audience is verified at the JWT layer)', () => {
      const meta = describePowerSyncCrudEndpoint();
      expect(meta.public).toBe(false);
    });

    it('returns 204 on full success, 409 on conflict', () => {
      const meta = describePowerSyncCrudEndpoint();
      expect(meta.successStatus).toBe(204);
      expect(meta.conflictStatus).toBe(409);
    });
  });
});
