import { describe, expect, it } from 'vitest';

import {
  CursorMalformedError,
  buildCursorPage,
  decodeCursor,
  encodeCursor,
  type CursorRecord,
} from '../../src/core/pagination/cursor.js';

/**
 * Story · Cursor pagination (PLAN.md §32 Phase 8).
 *
 * Stable, append-only cursor pagination as an alternative to
 * page/limit. The cursor is opaque to the client — base64 of a
 * minimal JSON `{sortValue, id}` payload — so the controller can
 * change its sort key without breaking already-issued cursors.
 *
 * Page-shape contract: the controller fetches `limit + 1` rows,
 * passes the slice into `buildCursorPage(rows, limit)`, and gets
 * back `{ items, nextCursor }` with `items` capped at `limit` and
 * `nextCursor` populated only when there's a next page.
 */
describe('Story · Cursor pagination', () => {
  describe('encode / decode', () => {
    it('round-trips a cursor record', () => {
      const cursor = encodeCursor({ sortValue: '2026-04-28T12:00:00Z', id: 'r-1' });
      expect(decodeCursor(cursor)).toEqual({ sortValue: '2026-04-28T12:00:00Z', id: 'r-1' });
    });

    it('produces a URL-safe opaque string (no `=`, no `+`, no `/`)', () => {
      const cursor = encodeCursor({ sortValue: 'a', id: 'b' });
      expect(cursor).not.toMatch(/[=+/]/);
    });

    it('rejects an empty cursor string', () => {
      expect(() => decodeCursor('')).toThrow(CursorMalformedError);
    });

    it('rejects garbage (not base64-decodable JSON)', () => {
      expect(() => decodeCursor('not-base64-!!!')).toThrow(CursorMalformedError);
    });

    it('rejects a base64 payload missing required fields', () => {
      const bad = Buffer.from(JSON.stringify({ id: 'only-id' }), 'utf8').toString('base64url');
      expect(() => decodeCursor(bad)).toThrow(CursorMalformedError);
    });

    it('handles numeric sortValues round-trip', () => {
      const cursor = encodeCursor({ sortValue: 42, id: 'r-1' });
      expect(decodeCursor(cursor)).toEqual({ sortValue: 42, id: 'r-1' });
    });
  });

  describe('buildCursorPage', () => {
    function record(overrides: Partial<CursorRecord> = {}): CursorRecord {
      return { id: 'r-1', sortValue: '2026-04-28T12:00:00Z', ...overrides };
    }

    it('returns every item and no cursor when fewer rows than limit', () => {
      const page = buildCursorPage(
        [record({ id: 'a' }), record({ id: 'b' })],
        10,
      );
      expect(page.items.map((i) => i.id)).toEqual(['a', 'b']);
      expect(page.nextCursor).toBeUndefined();
    });

    it('returns every item and no cursor when exactly limit rows (no next page)', () => {
      const rows = Array.from({ length: 3 }, (_, idx) => record({ id: `r-${idx}` }));
      const page = buildCursorPage(rows, 3);
      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).toBeUndefined();
    });

    it('drops the lookahead row and emits a cursor when limit+1 rows arrive', () => {
      const rows = Array.from({ length: 4 }, (_, idx) =>
        record({ id: `r-${idx}`, sortValue: `2026-04-28T0${idx}:00:00Z` }),
      );
      const page = buildCursorPage(rows, 3);
      expect(page.items.map((i) => i.id)).toEqual(['r-0', 'r-1', 'r-2']);
      expect(page.nextCursor).toBeDefined();
      expect(decodeCursor(page.nextCursor!)).toEqual({
        sortValue: '2026-04-28T02:00:00Z',
        id: 'r-2',
      });
    });

    it('rejects non-positive limit', () => {
      expect(() => buildCursorPage([record()], 0)).toThrow(/limit/i);
      expect(() => buildCursorPage([record()], -1)).toThrow(/limit/i);
    });

    it('returns an empty page from an empty input', () => {
      const page = buildCursorPage([], 10);
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeUndefined();
    });

    it('uses the LAST kept item (not the lookahead) as the cursor seed', () => {
      // Smoke test for the off-by-one: the cursor must point at items[limit-1],
      // not items[limit] — otherwise the next page skips a row.
      const rows = Array.from({ length: 5 }, (_, idx) =>
        record({ id: `r-${idx}`, sortValue: String(idx) }),
      );
      const page = buildCursorPage(rows, 4);
      expect(page.items).toHaveLength(4);
      const decoded = decodeCursor(page.nextCursor!);
      expect(decoded.id).toBe('r-3');
      expect(decoded.sortValue).toBe('3');
    });
  });
});
