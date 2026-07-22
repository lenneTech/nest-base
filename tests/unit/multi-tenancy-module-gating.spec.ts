import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit · Multi-tenancy module gating (regression guard).
 *
 * `app.module.ts` snapshots `loadFeatures(process.env)` at module-import
 * time and decides — via `conditionalImport(features, "multiTenancy", …)`
 * — whether `TenantSelfServiceModule` and `TenantAdminModule` land in the
 * `@Module({ imports })` array.
 *
 * Before the fix the two modules were imported UNCONDITIONALLY, so the
 * tenant routes (`/me/tenants`, `/tenants`, `/hub/admin/tenants`) stayed
 * registered even with `multiTenancy` disabled — inconsistent with the
 * Hub nav planner, which already hides `/hub/admin/tenants` behind the same
 * flag.
 *
 * This guard introspects the `@Module()` decorator's `imports` metadata
 * (the established pattern from `tests/unit/bug-fixes.spec.ts`) under
 * both flag states. No NestJS app boot, no HTTP — deterministic and
 * cheap, so it cannot destabilise the parallel e2e worker pool.
 *
 * `vi.resetModules()` forces a fresh `app.module.ts` evaluation per case
 * so its top-level `loadFeatures(process.env)` re-reads the pinned env.
 */
describe("Unit · Multi-tenancy module gating", () => {
  const originalSecret = process.env.BETTER_AUTH_SECRET;
  const originalBaseUrl = process.env.APP_BASE_URL;
  const originalFlag = process.env.FEATURE_MULTI_TENANCY_ENABLED;

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-for-testing-purposes-only-1234567890abcd";
    process.env.APP_BASE_URL = "http://localhost:3000";
  });

  afterEach(() => {
    vi.resetModules();
    if (originalSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = originalSecret;
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
    if (originalFlag === undefined) delete process.env.FEATURE_MULTI_TENANCY_ENABLED;
    else process.env.FEATURE_MULTI_TENANCY_ENABLED = originalFlag;
  });

  /** Names of the modules registered in AppModule's `imports` for the given flag. */
  async function importedModuleNames(flag: string | undefined): Promise<string[]> {
    if (flag === undefined) delete process.env.FEATURE_MULTI_TENANCY_ENABLED;
    else process.env.FEATURE_MULTI_TENANCY_ENABLED = flag;
    vi.resetModules();
    const { AppModule } = await import("../../src/core/app/app.module.js");
    const imports = (Reflect.getMetadata("imports", AppModule) as unknown[]) ?? [];
    return imports.map((m) => (typeof m === "function" ? m.name : String(m)));
  }

  it("registers the tenant modules when multiTenancy is ENABLED", async () => {
    const names = await importedModuleNames("true");
    expect(names).toContain("TenantSelfServiceModule");
    expect(names).toContain("TenantAdminModule");
  });

  it("OMITS the tenant modules when multiTenancy is DISABLED", async () => {
    const names = await importedModuleNames("false");
    expect(names).not.toContain("TenantSelfServiceModule");
    expect(names).not.toContain("TenantAdminModule");
  });

  it("registers the tenant modules by DEFAULT (flag unset → schema default ON)", async () => {
    const names = await importedModuleNames(undefined);
    expect(names).toContain("TenantSelfServiceModule");
    expect(names).toContain("TenantAdminModule");
  });
});
