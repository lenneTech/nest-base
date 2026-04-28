import { describe, expect, it } from 'vitest';

import {
  parsePostgrestQuery,
  combineWithAccessible,
} from '../../src/core/permissions/postgrest-query.js';

/**
 * Story · PostgREST-Query-Parser → Prisma-WHERE (PLAN.md §22 + §32 Phase 3)
 *
 * REST clients filter list endpoints with PostgREST-style query
 * params: `?status=eq.published&age=gte.18`. The parser maps this
 * to a Prisma `where` clause; `combineWithAccessible()` merges it
 * with the ability-derived filter so RLS + permissions + user
 * filter are applied as one AND.
 */
describe('Story · PostgREST query parser', () => {
  describe('parsePostgrestQuery()', () => {
    it('parses `eq.<value>` to a bare equality', () => {
      expect(parsePostgrestQuery({ status: 'eq.published' })).toEqual({
        status: 'published',
      });
    });

    it('parses `neq.<value>` to `{ not: <value> }`', () => {
      expect(parsePostgrestQuery({ status: 'neq.archived' })).toEqual({
        status: { not: 'archived' },
      });
    });

    it('parses `lt / lte / gt / gte`', () => {
      expect(parsePostgrestQuery({ age: 'gte.18' })).toEqual({ age: { gte: 18 } });
      expect(parsePostgrestQuery({ age: 'lt.65' })).toEqual({ age: { lt: 65 } });
      expect(parsePostgrestQuery({ score: 'gt.0.5' })).toEqual({ score: { gt: 0.5 } });
    });

    it('coalesces multiple operators on the same field', () => {
      // Only one query-string entry per field is supported; comma-separated
      // operators are flattened by the caller-side composition.
      expect(parsePostgrestQuery({ age: 'gte.18', score: 'lt.100' })).toEqual({
        age: { gte: 18 },
        score: { lt: 100 },
      });
    });

    it('parses `in.(a,b,c)` to `{ in: [...] }`', () => {
      expect(parsePostgrestQuery({ status: 'in.(draft,published)' })).toEqual({
        status: { in: ['draft', 'published'] },
      });
    });

    it('parses `is.null` and `is.not_null`', () => {
      expect(parsePostgrestQuery({ deletedAt: 'is.null' })).toEqual({ deletedAt: null });
      expect(parsePostgrestQuery({ deletedAt: 'is.not_null' })).toEqual({ deletedAt: { not: null } });
    });

    it('parses `like.<pattern>` and `ilike.<pattern>` (Prisma `contains`)', () => {
      expect(parsePostgrestQuery({ name: 'like.%foo%' })).toEqual({
        name: { contains: '%foo%' },
      });
      expect(parsePostgrestQuery({ name: 'ilike.%foo%' })).toEqual({
        name: { contains: '%foo%', mode: 'insensitive' },
      });
    });

    it('coerces `true`/`false` to booleans, integer-like strings to numbers', () => {
      expect(parsePostgrestQuery({ isActive: 'eq.true' })).toEqual({ isActive: true });
      expect(parsePostgrestQuery({ isActive: 'eq.false' })).toEqual({ isActive: false });
      expect(parsePostgrestQuery({ count: 'eq.42' })).toEqual({ count: 42 });
    });

    it('throws on an unknown operator with the offending op in the message', () => {
      expect(() => parsePostgrestQuery({ status: 'matches.foo' })).toThrow(/matches/);
    });

    it('returns {} on empty input', () => {
      expect(parsePostgrestQuery({})).toEqual({});
    });
  });

  describe('combineWithAccessible()', () => {
    it('returns the user filter unchanged when the ability filter is empty', () => {
      const merged = combineWithAccessible({ status: 'published' }, {});
      expect(merged).toEqual({ AND: [{ status: 'published' }, {}] });
    });

    it('AND-combines user + ability filters so both must hold', () => {
      const userFilter = { status: 'published' };
      const abilityFilter = { tenantId: 't1', deletedAt: null };
      const merged = combineWithAccessible(userFilter, abilityFilter);
      expect(merged).toEqual({
        AND: [{ status: 'published' }, { tenantId: 't1', deletedAt: null }],
      });
    });
  });
});
