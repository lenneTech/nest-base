import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · AdminCrudModule controllers (`/admin/roles`, `/admin/policies`,
 * `/admin/permissions`).
 *
 * Dev-Hub permission CRUD JSON must be `@Public()` + the operational
 * hub surface guard so local operators are not blocked by CanGuard
 * without a CASL session. Outside development the surface is gated by
 * FEATURE_HUB_ENABLED + the tenant-admin CASL wall in HubPortalMiddleware.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · AdminCrudModule dev gating", () => {
  it("admin-crud controllers use @Public and the operational surface guard on every handler", () => {
    const src = readFileSync(resolve(ROOT, "src/core/permissions/admin-crud.module.ts"), "utf8");
    expect(src).toContain('@Controller("admin/roles")');
    expect(src).toContain('@Controller("admin/policies")');
    expect(src).toContain('@Controller("admin/permissions")');
    expect(src).toContain("function assertOperationalAdminSurface");
    expect(src).toContain("DEV_ADMIN_CRUD_PUBLIC_REASON");
    const publicMatches = src.match(/@Public\(DEV_ADMIN_CRUD_PUBLIC_REASON\)/g) ?? [];
    expect(publicMatches.length).toBeGreaterThanOrEqual(19);
    expect(src).not.toMatch(/@Can\(/);
    expect(src).toContain("ConfigModule.forRoot()");
  });

  it("negotiate() does not chain .send() on setHeader (Express returns void)", () => {
    const src = readFileSync(resolve(ROOT, "src/core/permissions/admin-crud.module.ts"), "utf8");
    expect(src).not.toContain('setHeader("content-type", "text/html; charset=utf-8")\n      .send');
    expect(src).toContain(
      'res.setHeader("content-type", "text/html; charset=utf-8");\n    res.send(renderDevPortalShell',
    );
  });

  it("RolesAdminPage loads roles via session bootstrap + fetchJson", () => {
    const src = readFileSync(resolve(ROOT, "src/core/dx/clients/pages/RolesAdminPage.tsx"), "utf8");
    expect(src).toContain("bootstrapHubOperatorSession");
    expect(src).toContain('fetchJson<RoleRecord[]>("/admin/roles")');
    expect(src).not.toContain("x-tenant-id");
  });
});
