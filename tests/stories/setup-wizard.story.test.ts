import { describe, expect, it } from 'vitest';

import {
  planSetup,
  type WizardAnswers,
} from '../../src/core/setup/setup-wizard.js';

/**
 * Story · Setup-Wizard (PLAN.md §19.5 + §32 Phase 7).
 *
 * The wizard is split into a pure planner + an interactive runner.
 * Only the planner is in scope for this slice — given a set of
 * answers, it returns a `WizardOutcome` describing exactly what would
 * be written to disk:
 *
 *   - `features`       resolved Features object via FeaturesSchema
 *   - `envExample`     deterministic .env template content
 *   - `featuresSource` TypeScript source for src/config/features.ts
 *
 * The CLI prompt loop layers on top of this — answers in, plan out,
 * runner writes the files. Keeping the planner pure means the wizard
 * is fully unit-testable and idempotent.
 */
describe('Story · Setup-Wizard planner', () => {
  function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
    return {
      projectName: 'my-app',
      multiTenant: true,
      mobile: false,
      webhooks: false,
      search: false,
      mcp: false,
      fieldEncryption: false,
      realtime: false,
      emailEnabled: true,
      emailProvider: 'smtp',
      ...overrides,
    };
  }

  describe('feature mapping', () => {
    it('toggles mobile → powerSync', () => {
      expect(planSetup(answers({ mobile: true })).features.powerSync.enabled).toBe(true);
      expect(planSetup(answers({ mobile: false })).features.powerSync.enabled).toBe(false);
    });

    it('toggles webhooks', () => {
      expect(planSetup(answers({ webhooks: true })).features.webhooks.enabled).toBe(true);
      expect(planSetup(answers({ webhooks: false })).features.webhooks.enabled).toBe(false);
    });

    it('toggles search', () => {
      expect(planSetup(answers({ search: true })).features.search.enabled).toBe(true);
      expect(planSetup(answers({ search: false })).features.search.enabled).toBe(false);
    });

    it('toggles mcp', () => {
      expect(planSetup(answers({ mcp: true })).features.mcp.enabled).toBe(true);
    });

    it('toggles fieldEncryption', () => {
      expect(planSetup(answers({ fieldEncryption: true })).features.fieldEncryption.enabled).toBe(true);
    });

    it('toggles realtime', () => {
      expect(planSetup(answers({ realtime: true })).features.realtime.enabled).toBe(true);
    });

    it('toggles multiTenancy', () => {
      expect(planSetup(answers({ multiTenant: false })).features.multiTenancy.enabled).toBe(false);
      expect(planSetup(answers({ multiTenant: true })).features.multiTenancy.enabled).toBe(true);
    });

    it('routes email provider into features.email', () => {
      expect(planSetup(answers({ emailProvider: 'brevo' })).features.email.provider).toBe('brevo');
      expect(planSetup(answers({ emailProvider: 'smtp' })).features.email.provider).toBe('smtp');
    });

    it('disables email when emailEnabled=false', () => {
      expect(planSetup(answers({ emailEnabled: false })).features.email.enabled).toBe(false);
    });
  });

  describe('envExample', () => {
    it('starts with the project-name comment header', () => {
      const env = planSetup(answers({ projectName: 'cool-thing' })).envExample;
      expect(env.startsWith('# cool-thing')).toBe(true);
    });

    it('lists DATABASE_URL and BETTER_AUTH_SECRET unconditionally (auth + DB are mandatory)', () => {
      const env = planSetup(answers()).envExample;
      expect(env).toMatch(/^DATABASE_URL=/m);
      expect(env).toMatch(/^BETTER_AUTH_SECRET=/m);
    });

    it('includes BREVO_API_KEY when emailProvider=brevo', () => {
      const env = planSetup(answers({ emailProvider: 'brevo' })).envExample;
      expect(env).toMatch(/^BREVO_API_KEY=/m);
    });

    it('omits BREVO_API_KEY when emailProvider=smtp', () => {
      const env = planSetup(answers({ emailProvider: 'smtp' })).envExample;
      expect(env).not.toMatch(/^BREVO_API_KEY=/m);
    });

    it('includes FIELD_ENCRYPTION_KEK when fieldEncryption=true', () => {
      const env = planSetup(answers({ fieldEncryption: true })).envExample;
      expect(env).toMatch(/^FIELD_ENCRYPTION_KEK=/m);
    });

    it('omits FIELD_ENCRYPTION_KEK when fieldEncryption=false', () => {
      const env = planSetup(answers({ fieldEncryption: false })).envExample;
      expect(env).not.toMatch(/^FIELD_ENCRYPTION_KEK=/m);
    });

    it('is idempotent for the same answers', () => {
      const a = planSetup(answers());
      const b = planSetup(answers());
      expect(a.envExample).toBe(b.envExample);
      expect(a.featuresSource).toBe(b.featuresSource);
    });
  });

  describe('featuresSource', () => {
    it('imports FeaturesSchema and exports a `features` const', () => {
      const src = planSetup(answers()).featuresSource;
      expect(src).toMatch(/import .* from .*['"]\.\.\/core\/features\/features\.js['"]/);
      expect(src).toMatch(/export const features/);
    });

    it('reflects mobile=true in the rendered TypeScript', () => {
      const src = planSetup(answers({ mobile: true })).featuresSource;
      expect(src).toMatch(/powerSync:\s*\{\s*enabled:\s*true/);
    });

    it('rejects an empty project name', () => {
      expect(() => planSetup(answers({ projectName: '' }))).toThrow(/projectName/i);
    });
  });
});
