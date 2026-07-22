import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Email-Outbox Admin Controller (issue #91).
 *
 * Verifies the structural contract of the admin controller:
 *  - Routes exist at the expected paths.
 *  - JSON routes are `@Can('manage', 'EmailOutboxAdmin')` (production RBAC).
 *  - The planner is used (not inlined logic).
 *  - The module is registered in AppModule.
 *  - DI tokens are exported from the module.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · Email-Outbox Admin Controller", () => {
  describe("EmailOutboxAdminController structure", () => {
    it("controller source exists at the expected path", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      expect(src).toContain('@Controller("hub/admin/email-outbox")');
    });

    it("exposes GET list endpoint returning paginated rows", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Get\(\s*["']?list\.json["']?\s*\)/);
    });

    it("exposes GET detail endpoint for a single record", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Get\([^)]*:id[^)]*\)/);
    });

    it("exposes POST retry endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Post\([^)]*:id[^)]*retry[^)]*\)/);
    });

    it("exposes POST cancel endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Post\([^)]*:id[^)]*cancel[^)]*\)/);
    });

    it("exposes POST test-send endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      expect(src).toMatch(/@Post\([^)]*test-send[^)]*\)/);
    });

    it("JSON routes use @Can(manage, EmailOutboxAdmin) — not @Public", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      const canMatches = src.match(/@Can\(["']manage["'],\s*["']EmailOutboxAdmin["']\)/g) ?? [];
      expect(canMatches.length).toBeGreaterThanOrEqual(5);
      expect(src).not.toContain("private assertDev()");
      expect(src).not.toMatch(/@Public\(/);
    });

    it("uses planOutboxAdminAction from the action planner (not inlined)", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      expect(src).toContain("planOutboxAdminAction");
      expect(src).toContain('from "./email-outbox-action-planner.js"');
    });

    it("uses parseOutboxListFilter from the action planner", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.controller.ts"),
        "utf8",
      );
      expect(src).toContain("parseOutboxListFilter");
    });
  });

  describe("EmailOutboxAdminModule registration", () => {
    it("module file exists", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/email/email-outbox-admin.module.ts"),
        "utf8",
      );
      expect(src).toContain("EmailOutboxAdminModule");
    });

    it("AppModule imports EmailOutboxAdminModule", () => {
      const src = readFileSync(resolve(ROOT, "src/core/app/app.module.ts"), "utf8");
      expect(src).toContain("EmailOutboxAdminModule");
      expect(src).toContain('from "../email/email-outbox-admin.module.js"');
    });
  });

  describe("EmailOutboxPage frontend", () => {
    it("page component exports EmailOutboxPage", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/EmailOutboxPage.tsx"),
        "utf8",
      );
      expect(src).toContain("export function EmailOutboxPage");
    });

    it("page connects to the admin list endpoint", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/EmailOutboxPage.tsx"),
        "utf8",
      );
      expect(src).toContain("admin/email-outbox");
    });

    it("page implements 30s auto-refresh", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/EmailOutboxPage.tsx"),
        "utf8",
      );
      // 30 seconds in ms
      expect(src).toContain("30_000");
    });

    it("page renders retry and cancel action buttons", () => {
      const src = readFileSync(
        resolve(ROOT, "src/core/dx/clients/pages/EmailOutboxPage.tsx"),
        "utf8",
      );
      expect(src.toLowerCase()).toContain("retry");
      expect(src.toLowerCase()).toContain("cancel");
    });
  });
});
