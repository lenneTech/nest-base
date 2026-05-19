import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Rate-Limit Admin Controller (issue #94).
 *
 * Verifies the structural contract of the admin controller:
 *  - Routes exist at the expected paths.
 *  - JSON routes are `@Can('manage', 'RateLimitAdmin')`; SPA shell is `@Public()`.
 *  - The module is registered in AppModule when rate limiting is enabled.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · Rate-Limit Admin Controller", () => {
  describe("RateLimitAdminController structure", () => {
    it("controller source exists at the expected path", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.controller.ts"),
        "utf8",
      );
      expect(src).toContain('@Controller("admin/rate-limits")');
    });

    it("exposes GET inspector.json endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Get\(\s*["']inspector\.json["']\s*\)/);
    });

    it("exposes GET config.json endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Get\(\s*["']config\.json["']\s*\)/);
    });

    it("exposes GET decisions.json endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Get\(\s*["']decisions\.json["']\s*\)/);
    });

    it("exposes GET allowlist.json endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Get\(\s*["']allowlist\.json["']\s*\)/);
    });

    it("exposes POST key reset and endpoint reset-all endpoints", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Post\([^)]*keys[^)]*reset[^)]*\)/);
      expect(src).toMatch(/@Post\([^)]*endpoints[^)]*reset-all[^)]*\)/);
    });

    it("JSON routes use @Can(manage, RateLimitAdmin); shell only is @Public", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Public\(\s*\n?\s*"Dev-Hub admin SPA shell/);
      expect(src).not.toMatch(/@Public\(\s*\n?\s*"Dev-Hub rate-limits operator/);
      expect(src).not.toContain("private assertDev()");
      const canMatches = src.match(/@Can\(["']manage["'],\s*["']RateLimitAdmin["']\)/g) ?? [];
      expect(canMatches.length).toBeGreaterThanOrEqual(10);
    });

    it("uses validateRateLimitConfig from the config planner", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.controller.ts"),
        "utf8",
      );
      expect(src).toContain("validateRateLimitConfig");
      expect(src).toContain('from "./rate-limit-config-planner.js"');
    });
  });

  describe("RateLimitAdminModule registration", () => {
    it("module file exists", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/throttler/rate-limit-admin.module.ts"),
        "utf8",
      );
      expect(src).toContain("RateLimitAdminModule");
    });

    it("AppModule imports RateLimitAdminModule when rate limiting is enabled", () => {
      const src = readFileSync(resolve(ROOT, "src/core/app/app.module.ts"), "utf8");
      expect(src).toContain("RateLimitAdminModule");
      expect(src).toContain('from "../throttler/rate-limit-admin.module.js"');
    });
  });

  describe("RateLimitsAdminPage frontend", () => {
    it("page component exports RateLimitsAdminPage", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/RateLimitsAdminPage.tsx"),
        "utf8",
      );
      expect(src).toContain("export function RateLimitsAdminPage");
    });

    it("page connects to the admin inspector endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/RateLimitsAdminPage.tsx"),
        "utf8",
      );
      expect(src).toContain("/admin/rate-limits/inspector.json");
    });
  });
});
