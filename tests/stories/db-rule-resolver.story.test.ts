import { describe, expect, it } from 'vitest';

import {
  resolveDbRules,
  type DbPermissionRow,
  type ResolveContext,
} from '../../src/core/permissions/db-rule-resolver.js';

/**
 * Story · DB-Rule → CASL-Rule Resolver (PLAN.md §6.2)
 *
 * Persisted `Permission` rows speak Directus-style filter DSL with
 * variables (`$CURRENT_USER`, `$NOW`). The resolver:
 *   - lowercases the PermissionAction enum so `READ` → `'read'`
 *   - rewrites Directus operators (`_eq`, `_neq`, `_in`, …) into
 *     MongoDB-query operators that CASL's mongoQueryMatcher consumes
 *   - substitutes the variables against the current request context
 *   - propagates `fields` as the field-allowlist
 */
describe('Story · DB-Rule resolver', () => {
  const ctx: ResolveContext = {
    userId: 'user-1',
    now: new Date('2026-04-28T18:00:00Z'),
  };

  it('lowercases the action enum', () => {
    const rows: DbPermissionRow[] = [
      { resource: 'Project', action: 'READ', itemFilter: null, fields: [] },
      { resource: 'Project', action: 'CREATE', itemFilter: null, fields: [] },
    ];
    const rules = resolveDbRules(rows, ctx);
    expect(rules.map((r) => r.action)).toEqual(['read', 'create']);
    expect(rules.map((r) => r.subject)).toEqual(['Project', 'Project']);
  });

  it('emits no `conditions` when itemFilter is null', () => {
    const rows: DbPermissionRow[] = [{ resource: 'Project', action: 'READ', itemFilter: null, fields: [] }];
    const rules = resolveDbRules(rows, ctx);
    expect(rules[0]!.conditions).toBeUndefined();
  });

  describe('Directus → MongoDB operator translation', () => {
    it('_eq becomes the bare value (CASL field-equality)', () => {
      const rules = resolveDbRules(
        [{ resource: 'Project', action: 'READ', itemFilter: { status: { _eq: 'published' } }, fields: [] }],
        ctx,
      );
      expect(rules[0]!.conditions).toEqual({ status: 'published' });
    });

    it('_neq → $ne', () => {
      const rules = resolveDbRules(
        [{ resource: 'Project', action: 'READ', itemFilter: { status: { _neq: 'archived' } }, fields: [] }],
        ctx,
      );
      expect(rules[0]!.conditions).toEqual({ status: { $ne: 'archived' } });
    });

    it('_in / _nin', () => {
      const rules = resolveDbRules(
        [
          {
            resource: 'Project',
            action: 'READ',
            itemFilter: { status: { _in: ['draft', 'published'] }, type: { _nin: ['x'] } },
            fields: [],
          },
        ],
        ctx,
      );
      expect(rules[0]!.conditions).toEqual({
        status: { $in: ['draft', 'published'] },
        type: { $nin: ['x'] },
      });
    });

    it('_lt / _lte / _gt / _gte', () => {
      const rules = resolveDbRules(
        [
          {
            resource: 'Project',
            action: 'READ',
            itemFilter: { score: { _gte: 5, _lt: 10 } },
            fields: [],
          },
        ],
        ctx,
      );
      expect(rules[0]!.conditions).toEqual({ score: { $gte: 5, $lt: 10 } });
    });
  });

  describe('Variable substitution', () => {
    it('$CURRENT_USER → ctx.userId', () => {
      const rules = resolveDbRules(
        [
          {
            resource: 'Project',
            action: 'READ',
            itemFilter: { ownerId: { _eq: '$CURRENT_USER' } },
            fields: [],
          },
        ],
        ctx,
      );
      expect(rules[0]!.conditions).toEqual({ ownerId: 'user-1' });
    });

    it('$NOW → ctx.now (ISO string)', () => {
      const rules = resolveDbRules(
        [
          {
            resource: 'Project',
            action: 'READ',
            itemFilter: { publishedAt: { _lte: '$NOW' } },
            fields: [],
          },
        ],
        ctx,
      );
      expect(rules[0]!.conditions).toEqual({ publishedAt: { $lte: '2026-04-28T18:00:00.000Z' } });
    });

    it('substitutes inside arrays (_in)', () => {
      const rules = resolveDbRules(
        [
          {
            resource: 'Project',
            action: 'READ',
            itemFilter: { ownerId: { _in: ['$CURRENT_USER', 'system'] } },
            fields: [],
          },
        ],
        ctx,
      );
      expect(rules[0]!.conditions).toEqual({ ownerId: { $in: ['user-1', 'system'] } });
    });
  });

  describe('Field allowlist', () => {
    it('an empty fields array means "no fields readable"', () => {
      const rules = resolveDbRules(
        [{ resource: 'User', action: 'READ', itemFilter: null, fields: [] }],
        ctx,
      );
      expect(rules[0]!.fields).toEqual([]);
    });

    it('a non-empty fields array passes through verbatim', () => {
      const rules = resolveDbRules(
        [{ resource: 'User', action: 'READ', itemFilter: null, fields: ['id', 'email'] }],
        ctx,
      );
      expect(rules[0]!.fields).toEqual(['id', 'email']);
    });
  });

  it('rejects unknown operators with a deterministic error', () => {
    expect(() =>
      resolveDbRules(
        [
          {
            resource: 'Project',
            action: 'READ',
            itemFilter: { status: { _matches: '^pub' } },
            fields: [],
          },
        ],
        ctx,
      ),
    ).toThrow(/_matches/);
  });
});
