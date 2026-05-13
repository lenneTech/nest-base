import { describe, expect, it } from "vitest";

import {
  FeaturesSchema,
  conditionalImport,
  loadFeatures,
  validateFeatureDependencies,
} from "../../src/core/features/features.js";

/**
 * Story · Feature-Flag-System
 *
 * Single source of truth: `src/core/features/features.ts` declares every
 * feature toggle as a Zod schema. ENV-Vars `FEATURE_*` override fields,
 * `loadFeatures()` produces the validated record, `conditionalImport()`
 * is consumed by `AppModule` to gate module imports, and
 * `validateFeatureDependencies()` fails fast when a feature is enabled
 * without its required base feature.
 */
describe("Story · Feature-Flag-System", () => {
  describe("FeaturesSchema defaults", () => {
    it("parses an empty input into the documented defaults", () => {
      const features = FeaturesSchema.parse({});
      expect(features.authMethods.emailPassword).toBe(true);
      expect(features.authMethods.passkey).toBe(true);
      expect(features.multiTenancy.enabled).toBe(true);
      expect(features.files.enabled).toBe(true);
      expect(features.email.enabled).toBe(true);
      expect(features.rateLimit.enabled).toBe(true);
      expect(features.idempotency.enabled).toBe(true);
      expect(features.observability.enabled).toBe(true);
      expect(features.jobs.enabled).toBe(true);
      // Optional, default OFF
      expect(features.webhooks.enabled).toBe(false);
      expect(features.search.enabled).toBe(false);
      expect(features.realtime.enabled).toBe(false);
      expect(features.powerSync.enabled).toBe(false);
      expect(features.mcp.enabled).toBe(false);
      expect(features.fieldEncryption.enabled).toBe(false);
      expect(features.geo.enabled).toBe(false);
      // H2 fix: these two were previously read from process.env directly —
      // they now live in FeaturesSchema with default=false.
      expect(features.passwordPolicy.enabled).toBe(false);
      expect(features.filesMimeStrict.enabled).toBe(false);
    });

    it("rejects unknown enum values for storageDefault", () => {
      const result = FeaturesSchema.safeParse({ files: { storageDefault: "unknown-driver" } });
      expect(result.success).toBe(false);
    });

    it("includes the deviceManagement schema with privacy-friendly defaults", () => {
      // Issue #13: device-handling is opt-in (default off) so a fresh
      // project doesn't accumulate device fingerprints unless the
      // operator deliberately turns it on.
      const features = FeaturesSchema.parse({});
      expect(features.deviceManagement.enabled).toBe(false);
      expect(features.deviceManagement.maxDevicesPerUser).toBe(10);
      expect(features.deviceManagement.notifyOnNewDevice).toBe(true);
      expect(features.deviceManagement.sessionFingerprint).toBe("userAgent+ipSubnet");
    });

    it("rejects an invalid sessionFingerprint mode", () => {
      const result = FeaturesSchema.safeParse({
        deviceManagement: { sessionFingerprint: "fingerprint-everything" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-positive maxDevicesPerUser", () => {
      // 0 / negative → schema must fail. The hook would otherwise
      // never let a sign-in through (every session immediately
      // exceeds the cap).
      expect(FeaturesSchema.safeParse({ deviceManagement: { maxDevicesPerUser: 0 } }).success).toBe(
        false,
      );
      expect(
        FeaturesSchema.safeParse({ deviceManagement: { maxDevicesPerUser: -1 } }).success,
      ).toBe(false);
    });
  });

  describe("loadFeatures(env) — FEATURE_* ENV-Overrides", () => {
    it("applies FEATURE_<MODULE>_ENABLED to enable optional modules", () => {
      const features = loadFeatures({
        FEATURE_WEBHOOKS_ENABLED: "true",
        FEATURE_REALTIME_ENABLED: "1",
        // jobs already on by default — webhooks dependency satisfied
      });
      expect(features.webhooks.enabled).toBe(true);
      expect(features.realtime.enabled).toBe(true);
    });

    it("applies FEATURE_<MODULE>_ENABLED=false to disable default-on modules", () => {
      const features = loadFeatures({ FEATURE_FILES_ENABLED: "false" });
      expect(features.files.enabled).toBe(false);
    });

    it("applies FEATURE_FILES_STORAGE_DEFAULT to swap storage driver", () => {
      const features = loadFeatures({ FEATURE_FILES_STORAGE_DEFAULT: "local" });
      expect(features.files.storageDefault).toBe("local");
    });

    it("applies FEATURE_AUTH_METHODS_PASSKEY=false to disable passkey only", () => {
      const features = loadFeatures({ FEATURE_AUTH_METHODS_PASSKEY: "false" });
      expect(features.authMethods.passkey).toBe(false);
      expect(features.authMethods.emailPassword).toBe(true);
    });

    it("rejects FEATURE_FILES_STORAGE_DEFAULT with an invalid driver", () => {
      expect(() => loadFeatures({ FEATURE_FILES_STORAGE_DEFAULT: "bogus" })).toThrow();
    });

    it("treats `1`/`0`/`yes`/`no` as truthy/falsy synonyms", () => {
      const a = loadFeatures({ FEATURE_WEBHOOKS_ENABLED: "yes" });
      expect(a.webhooks.enabled).toBe(true);
      const b = loadFeatures({ FEATURE_FILES_ENABLED: "no" });
      expect(b.files.enabled).toBe(false);
    });

    it("throws on a non-boolean value where boolean is expected", () => {
      expect(() => loadFeatures({ FEATURE_WEBHOOKS_ENABLED: "maybe" })).toThrow(/boolean/i);
    });

    it("ignores empty-string env-vars", () => {
      const features = loadFeatures({ FEATURE_WEBHOOKS_ENABLED: "" });
      expect(features.webhooks.enabled).toBe(false);
    });

    it("ignores env-vars without the FEATURE_ prefix", () => {
      const features = loadFeatures({ NODE_ENV: "production", SOMETHING_ELSE: "true" });
      expect(features.webhooks.enabled).toBe(false);
    });

    it("ignores FEATURE_<UNKNOWN> sections", () => {
      const features = loadFeatures({ FEATURE_GRAVITY_ENABLED: "true" });
      expect(features.webhooks.enabled).toBe(false);
    });

    it("H2 fix: FEATURE_PASSWORD_POLICY_ENABLED toggles features.passwordPolicy.enabled", () => {
      const on = loadFeatures({ FEATURE_PASSWORD_POLICY_ENABLED: "true" });
      expect(on.passwordPolicy.enabled).toBe(true);
      const off = loadFeatures({ FEATURE_PASSWORD_POLICY_ENABLED: "false" });
      expect(off.passwordPolicy.enabled).toBe(false);
    });

    it("H2 fix: FEATURE_FILES_MIME_STRICT_ENABLED toggles features.filesMimeStrict.enabled", () => {
      const on = loadFeatures({ FEATURE_FILES_MIME_STRICT_ENABLED: "true" });
      expect(on.filesMimeStrict.enabled).toBe(true);
      const off = loadFeatures({ FEATURE_FILES_MIME_STRICT_ENABLED: "false" });
      expect(off.filesMimeStrict.enabled).toBe(false);
    });

    it("parses comma-separated socialProviders into an array", () => {
      const features = loadFeatures({ FEATURE_AUTH_METHODS_SOCIAL_PROVIDERS: "google,github" });
      expect(features.authMethods.socialProviders).toEqual(["google", "github"]);
    });
  });

  describe("validateFeatureDependencies()", () => {
    it("passes when only default features are active", () => {
      const features = FeaturesSchema.parse({});
      expect(() => validateFeatureDependencies(features)).not.toThrow();
    });

    it("throws when webhooks is enabled but jobs is disabled (jobs is the queue backend)", () => {
      const features = FeaturesSchema.parse({
        webhooks: { enabled: true },
        jobs: { enabled: false },
      });
      expect(() => validateFeatureDependencies(features)).toThrow(/webhooks.*jobs/i);
    });

    it("throws when rateLimit is disabled in production", () => {
      // documented invariant: rateLimit cannot be off in production-like config
      const features = FeaturesSchema.parse({ rateLimit: { enabled: false } });
      expect(() => validateFeatureDependencies(features, { env: "production" })).toThrow(
        /rateLimit/i,
      );
    });

    it("does not enforce production-only invariants in development", () => {
      const features = FeaturesSchema.parse({ rateLimit: { enabled: false } });
      expect(() => validateFeatureDependencies(features, { env: "development" })).not.toThrow();
    });

    it("L5 fix: throws when email.provider=smtp and EMAIL_HOST is not set in production", () => {
      const features = FeaturesSchema.parse({ email: { enabled: true, provider: "smtp" } });
      // The EMAIL_HOST check is production-only — matching the rateLimit pattern —
      // so that the default smtp config does not break test / dev boots.
      // emailHost is passed via context instead of read from process.env (Fix #18).
      expect(() =>
        validateFeatureDependencies(features, { env: "production", emailHost: undefined }),
      ).toThrow(/EMAIL_HOST/i);
    });

    it("L5 fix: passes when email.provider=smtp and EMAIL_HOST is set in production", () => {
      const features = FeaturesSchema.parse({ email: { enabled: true, provider: "smtp" } });
      // Pass emailHost via context — pure-function contract (Fix #18).
      expect(() =>
        validateFeatureDependencies(features, {
          env: "production",
          emailHost: "smtp.example.com",
        }),
      ).not.toThrow();
    });

    it("L5 fix: does not throw when email is disabled even without EMAIL_HOST in production", () => {
      const features = FeaturesSchema.parse({ email: { enabled: false } });
      expect(() =>
        validateFeatureDependencies(features, { env: "production", emailHost: undefined }),
      ).not.toThrow();
    });
  });

  describe("conditionalImport()", () => {
    class WebhookModule {}
    class RealtimeModule {}

    it("returns [Module] when feature is enabled", () => {
      const features = FeaturesSchema.parse({ webhooks: { enabled: true } });
      expect(conditionalImport(features, "webhooks", WebhookModule)).toEqual([WebhookModule]);
    });

    it("returns [] when feature is disabled", () => {
      const features = FeaturesSchema.parse({});
      expect(conditionalImport(features, "realtime", RealtimeModule)).toEqual([]);
    });
  });
});
