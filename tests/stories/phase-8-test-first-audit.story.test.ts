import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Story · Phase 8 Test-First audit (PLAN.md §32 Phase 8).
 *
 * The Phase 8 Test-First entry promises six story files cover the
 * load-bearing reliability surfaces that ship in Phase 8. Iterations
 * 85–91 wrote and shipped each story; this audit pins file path AND
 * a describe-block fragment so a future doc rewrite or rename can't
 * silently drop one.
 */
describe('Story · Phase 8 Test-First audit', () => {
  const REQUIRED: Array<{ surface: string; file: string; describeFragment: string }> = [
    {
      surface: 'Idempotency-Key (Cache-Hit/Miss)',
      file: 'tests/stories/idempotency.story.test.ts',
      describeFragment: 'Idempotency',
    },
    {
      surface: 'ETag / If-Match (Optimistic-Concurrency)',
      file: 'tests/stories/etag.story.test.ts',
      describeFragment: 'ETag',
    },
    {
      surface: 'Cursor-Pagination',
      file: 'tests/stories/cursor-pagination.story.test.ts',
      describeFragment: 'Cursor pagination',
    },
    {
      surface: 'Throttler (Multi-Window, Postgres-Store)',
      file: 'tests/stories/throttler-postgres-store.story.test.ts',
      describeFragment: 'Throttler',
    },
    {
      surface: 'GDPR-Endpoints (Export, Delete, Anonymise)',
      file: 'tests/stories/gdpr.story.test.ts',
      describeFragment: 'GDPR',
    },
    {
      surface: 'Audit-Log (Create/Update/Delete-Tracking)',
      file: 'tests/stories/audit-log-extension.story.test.ts',
      describeFragment: 'Audit-Log',
    },
  ];

  for (const entry of REQUIRED) {
    it(`covers "${entry.surface}" via ${entry.file}`, () => {
      const full = resolve(ROOT, entry.file);
      expect(existsSync(full), `${entry.file} must exist`).toBe(true);
      const content = readFileSync(full, 'utf8');
      expect(content).toMatch(new RegExp(`describe\\([\\s\\S]*?${escapeRegex(entry.describeFragment)}`));
    });
  }

  it('all six required stories are present (no count drift)', () => {
    expect(REQUIRED).toHaveLength(6);
  });
});

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
