import { describe, expect, it } from "vitest";

import { planSetup, type WizardAnswers } from "../../src/core/setup/setup-wizard.js";

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
describe("Story · Setup-Wizard planner", () => {
  function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
    return {
      projectName: "my-app",
      multiTenant: true,
      mobile: false,
      webhooks: false,
      search: false,
      mcp: false,
      fieldEncryption: false,
      realtime: false,
      emailEnabled: true,
      emailProvider: "smtp",
      ...overrides,
    };
  }

  describe("feature mapping", () => {
    it("toggles mobile → powerSync", () => {
      expect(planSetup(answers({ mobile: true })).features.powerSync.enabled).toBe(true);
      expect(planSetup(answers({ mobile: false })).features.powerSync.enabled).toBe(false);
    });

    it("toggles webhooks", () => {
      expect(planSetup(answers({ webhooks: true })).features.webhooks.enabled).toBe(true);
      expect(planSetup(answers({ webhooks: false })).features.webhooks.enabled).toBe(false);
    });

    it("toggles search", () => {
      expect(planSetup(answers({ search: true })).features.search.enabled).toBe(true);
      expect(planSetup(answers({ search: false })).features.search.enabled).toBe(false);
    });

    it("toggles mcp", () => {
      expect(planSetup(answers({ mcp: true })).features.mcp.enabled).toBe(true);
    });

    it("toggles fieldEncryption", () => {
      expect(planSetup(answers({ fieldEncryption: true })).features.fieldEncryption.enabled).toBe(
        true,
      );
    });

    it("toggles realtime", () => {
      expect(planSetup(answers({ realtime: true })).features.realtime.enabled).toBe(true);
    });

    it("toggles multiTenancy", () => {
      expect(planSetup(answers({ multiTenant: false })).features.multiTenancy.enabled).toBe(false);
      expect(planSetup(answers({ multiTenant: true })).features.multiTenancy.enabled).toBe(true);
    });

    it("routes email provider into features.email", () => {
      expect(planSetup(answers({ emailProvider: "brevo" })).features.email.provider).toBe("brevo");
      expect(planSetup(answers({ emailProvider: "smtp" })).features.email.provider).toBe("smtp");
    });

    it("disables email when emailEnabled=false", () => {
      expect(planSetup(answers({ emailEnabled: false })).features.email.enabled).toBe(false);
    });
  });

  describe("envExample", () => {
    it("starts with the project-name comment header", () => {
      const env = planSetup(answers({ projectName: "cool-thing" })).envExample;
      expect(env.startsWith("# cool-thing")).toBe(true);
    });

    it("lists DATABASE_URL and BETTER_AUTH_SECRET unconditionally (auth + DB are mandatory)", () => {
      const env = planSetup(answers()).envExample;
      expect(env).toMatch(/^DATABASE_URL=/m);
      expect(env).toMatch(/^BETTER_AUTH_SECRET=/m);
    });

    it("includes BREVO_API_KEY when emailProvider=brevo", () => {
      const env = planSetup(answers({ emailProvider: "brevo" })).envExample;
      expect(env).toMatch(/^BREVO_API_KEY=/m);
    });

    it("omits BREVO_API_KEY when emailProvider=smtp", () => {
      const env = planSetup(answers({ emailProvider: "smtp" })).envExample;
      expect(env).not.toMatch(/^BREVO_API_KEY=/m);
    });

    it("includes FIELD_ENCRYPTION_KEK when fieldEncryption=true", () => {
      const env = planSetup(answers({ fieldEncryption: true })).envExample;
      expect(env).toMatch(/^FIELD_ENCRYPTION_KEK=/m);
    });

    it("omits FIELD_ENCRYPTION_KEK when fieldEncryption=false", () => {
      const env = planSetup(answers({ fieldEncryption: false })).envExample;
      expect(env).not.toMatch(/^FIELD_ENCRYPTION_KEK=/m);
    });

    it("is idempotent for the same answers", () => {
      const a = planSetup(answers());
      const b = planSetup(answers());
      expect(a.envExample).toBe(b.envExample);
      expect(a.featuresSource).toBe(b.featuresSource);
    });

    // The committed .env.example serves as the single source of truth for new
    // contributors; whichever vars the runtime actually reads MUST appear in it.
    // The list below mirrors what `process.env.X` references exist across the
    // codebase + what docker-compose interpolates.
    describe("covers every env var the codebase actually reads", () => {
      it("always emits server / boot vars (NODE_ENV, PORT, HOST, APP_BASE_URL)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^NODE_ENV=/m);
        expect(env).toMatch(/^PORT=/m);
        expect(env).toMatch(/^HOST=/m);
        expect(env).toMatch(/^APP_BASE_URL=/m);
      });

      it("APP_BASE_URL is the portless form for the project name (matches portless.yml)", () => {
        const env = planSetup(answers({ projectName: "cool-thing" })).envExample;
        expect(env).toMatch(/^APP_BASE_URL=https:\/\/api\.cool-thing\.localhost$/m);
      });

      it("always emits POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB (docker-compose interpolates these)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^POSTGRES_USER=/m);
        expect(env).toMatch(/^POSTGRES_PASSWORD=/m);
        expect(env).toMatch(/^POSTGRES_DB=/m);
      });

      it("always emits SYSTEM_SETUP_ADMIN_EMAIL + SYSTEM_SETUP_ADMIN_PASSWORD (matched-pair bootstrap)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^SYSTEM_SETUP_ADMIN_EMAIL=/m);
        expect(env).toMatch(/^SYSTEM_SETUP_ADMIN_PASSWORD=/m);
      });

      it("always emits S3_ACCESS_KEY / S3_SECRET_KEY (RustFS auth)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^S3_ACCESS_KEY=/m);
        expect(env).toMatch(/^S3_SECRET_KEY=/m);
      });

      it("emits POWERSYNC_DB_PASSWORD + POWERSYNC_JWKS_URL when mobile=true", () => {
        const env = planSetup(answers({ mobile: true })).envExample;
        expect(env).toMatch(/^POWERSYNC_DB_PASSWORD=/m);
        expect(env).toMatch(/^POWERSYNC_JWKS_URL=/m);
      });

      it("emits ERROR_DOC_BASE_URL (problem-details link)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^ERROR_DOC_BASE_URL=/m);
      });

      it("emits TENANT_HEADER when multi-tenancy is on", () => {
        const env = planSetup(answers({ multiTenant: true })).envExample;
        expect(env).toMatch(/^TENANT_HEADER=/m);
      });

      it("emits OTEL_RESOURCE_ATTRIBUTES (observability hint, optional)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^# OTEL_RESOURCE_ATTRIBUTES=|^OTEL_RESOURCE_ATTRIBUTES=/m);
      });
    });

    describe("feature-flag override block", () => {
      // Every FeaturesSchema toggle should appear (commented out, with the
      // schema default as the value) so devs can uncomment-and-edit
      // instead of looking up env-var names.
      it("lists every always-on toggle (rateLimit, idempotency, observability, jobs)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^#\s*FEATURE_RATE_LIMIT_ENABLED=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_IDEMPOTENCY_ENABLED=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_OBSERVABILITY_ENABLED=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_JOBS_ENABLED=true$/m);
      });

      it("lists every opt-in toggle (webhooks, search, realtime, powerSync, mcp, fieldEncryption, geo)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^#\s*FEATURE_WEBHOOKS_ENABLED=false$/m);
        expect(env).toMatch(/^#\s*FEATURE_SEARCH_ENABLED=false$/m);
        expect(env).toMatch(/^#\s*FEATURE_REALTIME_ENABLED=false$/m);
        expect(env).toMatch(/^#\s*FEATURE_POWERSYNC_ENABLED=false$/m);
        expect(env).toMatch(/^#\s*FEATURE_MCP_ENABLED=false$/m);
        expect(env).toMatch(/^#\s*FEATURE_FIELD_ENCRYPTION_ENABLED=false$/m);
        expect(env).toMatch(/^#\s*FEATURE_GEO_ENABLED=false$/m);
      });

      it("lists multiTenancy fields (enabled, RLS, header)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^#\s*FEATURE_MULTI_TENANCY_ENABLED=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_MULTI_TENANCY_RLS=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_MULTI_TENANCY_HEADER_NAME=x-tenant-id$/m);
      });

      it("lists files fields (enabled, storage default, tus, transformations)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^#\s*FEATURE_FILES_ENABLED=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_FILES_STORAGE_DEFAULT=s3$/m);
        expect(env).toMatch(/^#\s*FEATURE_FILES_TUS=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_FILES_TRANSFORMATIONS=true$/m);
      });

      it("lists email fields (enabled, provider)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^#\s*FEATURE_EMAIL_ENABLED=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_EMAIL_PROVIDER=smtp$/m);
      });

      it("lists geo fields (enabled, provider)", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^#\s*FEATURE_GEO_ENABLED=false$/m);
        expect(env).toMatch(/^#\s*FEATURE_GEO_PROVIDER=nominatim$/m);
      });

      it("lists every authMethods sub-toggle", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/^#\s*FEATURE_AUTH_METHODS_EMAIL_PASSWORD=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_AUTH_METHODS_TWO_FACTOR=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_AUTH_METHODS_PASSKEY=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_AUTH_METHODS_API_KEYS=true$/m);
        expect(env).toMatch(/^#\s*FEATURE_AUTH_METHODS_SOCIAL_PROVIDERS=$/m);
      });

      it("introduces the block with a banner so devs can find it", () => {
        const env = planSetup(answers()).envExample;
        expect(env).toMatch(/Feature flags/i);
      });
    });
  });

  describe("featuresSource", () => {
    it("imports FeaturesSchema and exports a `features` const", () => {
      const src = planSetup(answers()).featuresSource;
      expect(src).toMatch(/import .* from .*['"]\.\.\/core\/features\/features\.js['"]/);
      expect(src).toMatch(/export const features/);
    });

    it("reflects mobile=true in the rendered TypeScript", () => {
      const src = planSetup(answers({ mobile: true })).featuresSource;
      expect(src).toMatch(/powerSync:\s*\{\s*enabled:\s*true/);
    });

    it("rejects an empty project name", () => {
      expect(() => planSetup(answers({ projectName: "" }))).toThrow(/projectName/i);
    });
  });
});
