import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · User Admin Controller (issue #86).
 *
 * Verifies the structural contract of the admin controller:
 *  - Routes exist at the expected paths.
 *  - JSON routes are `@Can('manage', 'User')`; SPA shell is `@Public()`.
 *  - The module is registered in AppModule.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · User Admin Controller", () => {
  describe("UserAdminController structure", () => {
    it("controller source exists at the expected path", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.controller.ts"), "utf8");
      expect(src).toContain('@Controller("admin/users")');
    });

    it("exposes GET list.json endpoint", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.controller.ts"), "utf8");
      expect(src).toMatch(/@Get\(\s*["']list\.json["']\s*\)/);
    });

    it("exposes GET detail endpoint for a single user", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.controller.ts"), "utf8");
      expect(src).toMatch(/@Get\([^)]*:id\.json[^)]*\)/);
    });

    it("exposes ban, unban, revoke-sessions, create, update, and set-email-verified POST endpoints", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.controller.ts"), "utf8");
      expect(src).toMatch(/@Post\([^)]*:id\/ban[^)]*\)/);
      expect(src).toMatch(/@Post\([^)]*:id\/unban[^)]*\)/);
      expect(src).toMatch(/@Post\([^)]*revoke-sessions[^)]*\)/);
      expect(src).toMatch(/@Post\(\s*["']create["']\s*\)/);
      expect(src).toMatch(/@Post\([^)]*:id\/update[^)]*\)/);
      expect(src).toMatch(/@Post\([^)]*set-email-verified[^)]*\)/);
    });

    it("exposes PATCH member role on user detail (works without multi-tenancy UI)", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.controller.ts"), "utf8");
      expect(src).toMatch(/@Patch\([^)]*:id\/members\/:memberId\/role[^)]*\)/);
      expect(src).toMatch(/@Patch\([^)]*:id\/role[^)]*\)/);
      expect(src).toMatch(/@Get\(\s*["']roles\.json["']\s*\)/);
      expect(src).toContain("memberships");
      expect(src).toContain("rolesForUser");
      expect(src).toContain("resolveHubOperatorTenantId");
      expect(src).toContain("invalidate(");
    });

    it("forwards the operator session cookie and Origin to Better-Auth admin calls", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.controller.ts"), "utf8");
      expect(src).toContain("req.headers.cookie");
      expect(src).toContain("headers.cookie = cookie");
      expect(src).toContain("headers.origin = origin");
    });

    it("data routes use @Can(manage, User); shell only is @Public", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.controller.ts"), "utf8");
      expect(src).toMatch(/@Public\("dev-portal SPA shell/);
      expect(src).not.toMatch(/@Public\(\s*\n?\s*"Dev-Hub/);
      expect(src).not.toContain("private assertDev()");
      const canMatches = src.match(/@Can\(["']manage["'],\s*["']User["']\)/g) ?? [];
      expect(canMatches.length).toBeGreaterThanOrEqual(5);
    });

    it("uses filterUsers from the planner (not inlined)", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.controller.ts"), "utf8");
      expect(src).toContain("filterUsers");
      expect(src).toContain('from "./user-admin-planner.js"');
    });
  });

  describe("UserAdminModule registration", () => {
    it("module file exists", () => {
      const src = readFileSync(resolve(ROOT, "src/core/dx/user-admin.module.ts"), "utf8");
      expect(src).toContain("UserAdminModule");
    });

    it("AppModule imports UserAdminModule", () => {
      const src = readFileSync(resolve(ROOT, "src/core/app/app.module.ts"), "utf8");
      expect(src).toContain("UserAdminModule");
      expect(src).toContain('from "../dx/user-admin.module.js"');
    });
  });

  describe("UsersAdminPage frontend", () => {
    it("page component exports UsersAdminPage", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/UsersAdminPage.tsx"),
        "utf8",
      );
      expect(src).toContain("export function UsersAdminPage");
    });

    it("page connects to the admin list endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/UsersAdminPage.tsx"),
        "utf8",
      );
      expect(src).toContain("/admin/users/list.json");
      expect(src).toContain("/admin/users/roles.json");
      expect(src).toContain("/admin/users/create");
      expect(src).toContain("Create user");
      expect(src).toContain("set-email-verified");
      expect(src).toContain("Mark verified");
      expect(src).toContain("change-user-member-role");
      expect(src).toContain("assign-user-role");
      expect(src).toContain("/admin/users/");
      expect(src).toContain("/members/");
      expect(src).toContain("/role");
    });
  });
});
