import { describe, expect, it } from 'vitest';

import {
  ProtectedPathTouchedError,
  planSyncToTemplate,
} from '../../src/core/setup/sync-to-template.js';

/**
 * Story · sync:to-template (PLAN.md §32 Phase 7).
 *
 * Inverse of sync-from-template: given the local working tree and a
 * template `src/core/` snapshot, produce the patch payload that a PR
 * back to the template repo would carry.
 *
 *   - File only locally under src/core/ → add
 *   - File in both, content differs     → modify (with unified diff)
 *   - File in both, content equal       → skip
 *   - File only in template             → remove (suggested)
 *   - Anything outside src/core/ in either side → ignored / rejected
 *
 * The CLI runner clones the template repo, walks the local
 * src/core/, calls the planner, and writes a `core-pr.patch`. Keeping
 * the planner pure means we can test the diff output without git.
 */
describe('Story · sync:to-template planner', () => {
  function defaultLocal(): Record<string, string> {
    return {
      'src/modules/projects/projects.service.ts': 'export class ProjectsService {}',
      'tests/foo.spec.ts': 'export {};',
      'package.json': '{}',
    };
  }

  it('produces an "add" entry for a local-only src/core/ file', () => {
    const plan = planSyncToTemplate({
      local: { ...defaultLocal(), 'src/core/auth/new-helper.ts': 'export const a = 1;' },
      templateCore: {},
    });
    expect(plan.add.map((p) => p.path)).toEqual(['src/core/auth/new-helper.ts']);
    expect(plan.add[0]?.content).toBe('export const a = 1;');
    expect(plan.modify).toEqual([]);
  });

  it('produces a "modify" entry with a unified-diff body when content drifted', () => {
    const plan = planSyncToTemplate({
      local: { ...defaultLocal(), 'src/core/x.ts': 'line 1\nline 2-NEW\nline 3\n' },
      templateCore: { 'src/core/x.ts': 'line 1\nline 2\nline 3\n' },
    });
    expect(plan.modify).toHaveLength(1);
    const entry = plan.modify[0]!;
    expect(entry.path).toBe('src/core/x.ts');
    expect(entry.content).toBe('line 1\nline 2-NEW\nline 3\n');
    expect(entry.diff).toMatch(/^---\sa\/src\/core\/x\.ts/m);
    expect(entry.diff).toMatch(/^\+\+\+\sb\/src\/core\/x\.ts/m);
    expect(entry.diff).toContain('-line 2');
    expect(entry.diff).toContain('+line 2-NEW');
  });

  it('skips files with identical content', () => {
    const plan = planSyncToTemplate({
      local: { ...defaultLocal(), 'src/core/x.ts': 'same' },
      templateCore: { 'src/core/x.ts': 'same' },
    });
    expect(plan.skip).toEqual(['src/core/x.ts']);
    expect(plan.modify).toEqual([]);
  });

  it('produces a "remove" entry when the template has a file the local tree no longer has', () => {
    const plan = planSyncToTemplate({
      local: { ...defaultLocal() },
      templateCore: { 'src/core/legacy.ts': 'export const old = 1;' },
    });
    expect(plan.remove).toEqual(['src/core/legacy.ts']);
  });

  it('ignores everything outside src/core/ on the local side', () => {
    const plan = planSyncToTemplate({
      local: defaultLocal(),
      templateCore: {},
    });
    expect(plan.add).toEqual([]);
    expect(plan.modify).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.skip).toEqual([]);
  });

  it('rejects a templateCore snapshot containing paths outside src/core/', () => {
    expect(() =>
      planSyncToTemplate({
        local: defaultLocal(),
        templateCore: { 'src/modules/leak.ts': 'export {}' },
      }),
    ).toThrow(ProtectedPathTouchedError);
  });

  it('summary counts each bucket', () => {
    const plan = planSyncToTemplate({
      local: {
        ...defaultLocal(),
        'src/core/a.ts': '1', // add
        'src/core/b.ts': '2', // modify (template has b='old')
        'src/core/c.ts': '3', // skip
      },
      templateCore: {
        'src/core/b.ts': 'old',
        'src/core/c.ts': '3',
        'src/core/d.ts': '4', // remove
      },
    });
    expect(plan.summary).toEqual({ add: 1, modify: 1, skip: 1, remove: 1 });
  });

  it('mixes add / modify / skip / remove in a single planning call', () => {
    const plan = planSyncToTemplate({
      local: {
        ...defaultLocal(),
        'src/core/a.ts': 'new',
        'src/core/b.ts': 'changed',
        'src/core/c.ts': 'same',
      },
      templateCore: {
        'src/core/b.ts': 'old',
        'src/core/c.ts': 'same',
        'src/core/d.ts': 'gone',
      },
    });
    expect(plan.add.map((c) => c.path)).toEqual(['src/core/a.ts']);
    expect(plan.modify.map((c) => c.path)).toEqual(['src/core/b.ts']);
    expect(plan.skip).toEqual(['src/core/c.ts']);
    expect(plan.remove).toEqual(['src/core/d.ts']);
  });

  it('produces deterministic output (alphabetical path order per bucket)', () => {
    const plan = planSyncToTemplate({
      local: {
        ...defaultLocal(),
        'src/core/z.ts': '1',
        'src/core/a.ts': '1',
        'src/core/m.ts': '1',
      },
      templateCore: {},
    });
    expect(plan.add.map((p) => p.path)).toEqual(['src/core/a.ts', 'src/core/m.ts', 'src/core/z.ts']);
  });

  it('renderUnifiedPatch concatenates every modify entry in a single patch text', () => {
    const plan = planSyncToTemplate({
      local: {
        'src/core/x.ts': 'a\nb-NEW\n',
        'src/core/y.ts': '1\n2-NEW\n',
      },
      templateCore: {
        'src/core/x.ts': 'a\nb\n',
        'src/core/y.ts': '1\n2\n',
      },
    });
    const patch = plan.renderUnifiedPatch();
    expect(patch).toContain('diff --git a/src/core/x.ts b/src/core/x.ts');
    expect(patch).toContain('diff --git a/src/core/y.ts b/src/core/y.ts');
    expect(patch.indexOf('a/src/core/x.ts')).toBeLessThan(patch.indexOf('a/src/core/y.ts'));
  });
});
