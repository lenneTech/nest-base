import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildSyncSelectExcludingEncrypted,
  assertSyncRulesExcludeEncrypted,
} from '../../src/core/auth/powersync-encrypted-exclusion.js';

const ROOT = resolve(import.meta.dirname, '..', '..');

/**
 * Story · Encrypted-Fields excluded from PowerSync sync-rules
 *           (PLAN.md §15.5 + §32 Phase 5b).
 *
 * The publication is permissive (FOR ALL TABLES) — sync-rules.yaml is
 * the *only* place that decides which columns reach a mobile client.
 * If an encrypted column ever leaks into a `SELECT *` data query, the
 * client receives the AES-GCM ciphertext which is useless to it AND
 * inflates the WAL bandwidth. So:
 *
 *   - `buildSyncSelectExcludingEncrypted(allColumns, encryptedColumns)`
 *     produces an explicit column list with the encrypted ones removed.
 *   - `assertSyncRulesExcludeEncrypted(yamlText, registry)` is the
 *     audit that scans sync-rules.yaml for any forbidden token.
 */
describe('Story · Encrypted-Fields excluded from PowerSync sync-rules', () => {
  describe('buildSyncSelectExcludingEncrypted', () => {
    it('returns only the non-encrypted columns', () => {
      const select = buildSyncSelectExcludingEncrypted(
        ['id', 'street', 'zip', 'city', 'country'],
        ['street', 'zip'],
      );
      expect(select).toEqual(['id', 'city', 'country']);
    });

    it('preserves the original column order', () => {
      expect(
        buildSyncSelectExcludingEncrypted(['c', 'a', 'b'], []),
      ).toEqual(['c', 'a', 'b']);
    });

    it('is a no-op when nothing is encrypted', () => {
      expect(
        buildSyncSelectExcludingEncrypted(['id', 'name'], []),
      ).toEqual(['id', 'name']);
    });

    it('throws when an encrypted column is not in the column list (typo guard)', () => {
      expect(() =>
        buildSyncSelectExcludingEncrypted(['id', 'name'], ['streeet']),
      ).toThrow(/streeet/);
    });

    it('throws when the column list is empty (would emit SELECT FROM ...)', () => {
      expect(() =>
        buildSyncSelectExcludingEncrypted([], []),
      ).toThrow(/at least one column/);
    });
  });

  describe('assertSyncRulesExcludeEncrypted (live audit)', () => {
    it('the live sync-rules.yaml does not reference any registered encrypted column', () => {
      const path = resolve(ROOT, 'docker/powersync/sync-rules.yaml');
      expect(existsSync(path), 'sync-rules.yaml must exist').toBe(true);
      const yamlText = readFileSync(path, 'utf8');
      // The known encrypted-field registry across the project (Phase 5c).
      const registry = { addresses: ['street', 'zip'] as const };
      // Should NOT throw — sync-rules must not mention these columns.
      expect(() => assertSyncRulesExcludeEncrypted(yamlText, registry)).not.toThrow();
    });

    it('throws with a descriptive error if a forbidden column appears', () => {
      const yamlText = `
bucket_definitions:
  user:
    parameters: SELECT request.user_id() AS user_id
    data:
      - SELECT id, street FROM addresses WHERE userId = bucket.user_id
`;
      const registry = { addresses: ['street', 'zip'] as const };
      expect(() => assertSyncRulesExcludeEncrypted(yamlText, registry)).toThrow(
        /addresses\.street.*encrypted/i,
      );
    });
  });
});
