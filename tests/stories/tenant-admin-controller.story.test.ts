import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Tenant Admin Controller (issue #87).
 *
 * Verifies the structural contract of the admin controller:
 *  - Routes exist at the expected paths.
 *  - JSON routes are `@Can('manage', 'TenantAdmin')`; SPA shell is `@Public()`.
 *  - The module is registered in AppModule.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · Tenant Admin Controller", () => {
  describe("TenantAdminController structure", () => {
    it("controller source exists at the expected path", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/multi-tenancy/tenant-admin.controller.ts"),
        "utf8",
      );
      expect(src).toContain('@Controller("admin/tenants")');
    });

    it("exposes GET list.json endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/multi-tenancy/tenant-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Get\(\s*["']list\.json["']\s*\)/);
    });

    it("exposes GET detail endpoint for a single tenant", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/multi-tenancy/tenant-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Get\([^)]*:id\.json[^)]*\)/);
    });

    it("exposes POST create and member-management endpoints", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/multi-tenancy/tenant-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Post\(\)/);
      expect(src).toMatch(/members\/invite/);
    });

    it("data routes use @Can(manage, TenantAdmin); shell only is @Public", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/multi-tenancy/tenant-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Public\("dev-portal SPA shell/);
      expect(src).not.toMatch(/@Public\(\s*\n?\s*"Dev-Hub/);
      expect(src).not.toContain("private assertDev()");
      const canMatches = src.match(/@Can\(["']manage["'],\s*["']TenantAdmin["']\)/g) ?? [];
      expect(canMatches.length).toBeGreaterThanOrEqual(9);
    });

    it("uses filterTenants from the planner (not inlined)", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/multi-tenancy/tenant-admin.controller.ts"),
        "utf8",
      );
      expect(src).toContain("filterTenants");
      expect(src).toContain('from "./tenant-admin-planner.js"');
    });
  });

  describe("TenantAdminModule registration", () => {
    it("module file exists", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/multi-tenancy/tenant-admin.module.ts"),
        "utf8",
      );
      expect(src).toContain("TenantAdminModule");
    });

    it("AppModule imports TenantAdminModule", () => {
      const src = readFileSync(resolve(ROOT, "src/core/app/app.module.ts"), "utf8");
      expect(src).toContain("TenantAdminModule");
      expect(src).toContain('from "../multi-tenancy/tenant-admin.module.js"');
    });
  });

  describe("TenantsAdminPage frontend", () => {
    it("page component exports TenantsAdminPage", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/TenantsAdminPage.tsx"),
        "utf8",
      );
      expect(src).toContain("export function TenantsAdminPage");
    });

    it("page connects to the admin list endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/TenantsAdminPage.tsx"),
        "utf8",
      );
      expect(src).toContain("/admin/tenants/list.json");
    });
  });
});
