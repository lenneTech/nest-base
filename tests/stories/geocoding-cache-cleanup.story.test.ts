import { describe, expect, it } from 'vitest';

import {
  buildGeocodingCleanupPlan,
  DEFAULT_GEOCODING_CACHE_RETENTION_DAYS,
} from '../../src/core/geo/geocoding-cache-cleanup.js';

/**
 * Story · GeocodingCache cleanup cron (PLAN.md §15 + §32 Phase 5c).
 *
 * Pure planner: given the current time and a retention window in
 * days, return the WHERE clause + cutoff timestamp the cleanup job
 * runs daily. Default retention is 90 days (PLAN.md §15.6).
 *
 * The runner side (the actual `DELETE FROM geocoding_cache WHERE …`
 * + the pg-boss cron registration) lives in the persistence layer;
 * keeping the planner I/O-free means we can verify the boundary
 * arithmetic without spinning Postgres.
 */
describe('Story · GeocodingCache cleanup', () => {
  describe('buildGeocodingCleanupPlan()', () => {
    it('uses 90 days as the default retention', () => {
      expect(DEFAULT_GEOCODING_CACHE_RETENTION_DAYS).toBe(90);
    });

    it('returns a cutoff = now − retention days', () => {
      const now = Date.parse('2026-04-28T12:00:00Z');
      const plan = buildGeocodingCleanupPlan({ now, retentionDays: 90 });
      expect(plan.cutoffMs).toBe(now - 90 * 24 * 3_600 * 1_000);
    });

    it('renders the cutoff as ISO string for SQL substitution', () => {
      const plan = buildGeocodingCleanupPlan({
        now: Date.parse('2026-04-28T12:00:00Z'),
        retentionDays: 90,
      });
      expect(plan.cutoffIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(plan.cutoffIso).toBe('2026-01-28T12:00:00.000Z');
    });

    it('includes both the time-based and the explicit-expiry filter (defense in depth)', () => {
      const plan = buildGeocodingCleanupPlan({
        now: Date.parse('2026-04-28T12:00:00Z'),
        retentionDays: 90,
      });
      expect(plan.where).toMatch(/createdAt"?\s*<\s*\$1/i);
      expect(plan.where).toMatch(/expiresAt"?\s*<\s*\$2/i);
      expect(plan.where).toMatch(/OR/i);
    });

    it('honours a custom retention window', () => {
      const now = Date.parse('2026-04-28T00:00:00Z');
      const plan = buildGeocodingCleanupPlan({ now, retentionDays: 7 });
      expect(plan.cutoffMs).toBe(now - 7 * 24 * 3_600 * 1_000);
    });

    it('rejects a non-positive retention', () => {
      expect(() => buildGeocodingCleanupPlan({ now: 0, retentionDays: 0 })).toThrow(/retention/i);
      expect(() => buildGeocodingCleanupPlan({ now: 0, retentionDays: -1 })).toThrow(/retention/i);
    });

    it('returns the parameter array in the same order the WHERE references them', () => {
      const plan = buildGeocodingCleanupPlan({
        now: Date.parse('2026-04-28T12:00:00Z'),
        retentionDays: 90,
      });
      expect(plan.params).toHaveLength(2);
      // both bind to the cutoff (createdAt < cutoff OR expiresAt < cutoff)
      expect(plan.params[0]).toBe(plan.cutoffIso);
      expect(plan.params[1]).toBe(plan.cutoffIso);
    });
  });
});
