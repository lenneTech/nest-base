import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · AdminCrudModule controllers (`/admin/roles`, `/admin/policies`,
 * `/admin/permissions`).
 *
 * Dev-Hub permission CRUD JSON must be `@Public()` + `assertDevPortalOnly()`
 * so local operators are not blocked by CanGuard without a CASL session.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · AdminCrudModule dev gating", () => {
  it("admin-crud controllers use @Public and assertDevPortalOnly on every handler", () => {
    const src = readFileSync(
      resolve(ROOT, "src/core/permissions/admin-crud.module.ts"),
      "utf8",
    );
    expect(src).toContain('@Controller("admin/roles")');
    expect(src).toContain('@Controller("admin/policies")');
    expect(src).toContain('@Controller("admin/permissions")');
    expect(src).toContain("function assertDevPortalOnly");
    expect(src).toContain("DEV_ADMIN_CRUD_PUBLIC_REASON");
    const publicMatches = src.match(/@Public\(DEV_ADMIN_CRUD_PUBLIC_REASON\)/g) ?? [];
    expect(publicMatches.length).toBeGreaterThanOrEqual(19);
    expect(src).not.toMatch(/@Can\(/);
    expect(src).toContain("ConfigModule.forRoot()");
  });

  it("RolesAdminPage sends x-tenant-id when loading roles", () => {
    const src = readFileSync(
      resolve(ROOT, "src/core/dx/clients/pages/RolesAdminPage.tsx"),
      "utf8",
    );
    expect(src).toContain("fetchJsonWithTenant");
    expect(src).toContain('"/admin/roles"');
    expect(src).toContain("readTenantIdFromCookie");
  });
});
