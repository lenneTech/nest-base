import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Sessions admin + impersonation controllers (CF.AUTH.SESSIONS + CF.AUTH.IMPERSONATION).
 *
 * The PRD requires HTTP surfaces for:
 *   - Single session revoke (`DELETE /admin/sessions/:sessionId`)
 *   - Bulk-by-user revoke (`POST /admin/sessions/revoke-bulk-by-user`)
 *   - "Log out other devices" self-service (`POST /admin/sessions/revoke-others`)
 *   - Impersonation stop (`POST /admin/impersonation/stop`)
 *
 * Each route is gated by `@Can("delete", "Session")` so only the
 * Administrator role can hit the bulk paths; the self-service path
 * works for any authenticated user because the planner narrows the
 * affected sessions to the request user via the `bulk-by-user-except-current`
 * strategy.
 *
 * The audit emission flows through tokens (`SESSION_REVOKE_AUDIT_SINK`,
 * `IMPERSONATION_AUDIT_SINK`) so projects override the default no-op
 * sinks with their audit-log writer.
 *
 * The behaviour is exercised end-to-end via Better-Auth's session
 * adapter once the Prisma binding lands (the default sentinel storage
 * returns `[]` so any 200 path 404s on "no matching sessions"). This
 * story locks the structural contract: routes mounted, tokens defined,
 * planners consumed correctly.
 */
const ROOT = resolve(__dirname, "..", "..");

describe("Story · sessions-admin + impersonation controllers", () => {
  describe("SessionsAdminController", () => {
    it("source defines the 3 expected routes (single, bulk-by-user, revoke-others)", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/sessions-admin.controller.ts"), "utf8");
      expect(src).toMatch(/@Delete\(["']:sessionId["']\)/);
      expect(src).toMatch(/@Post\(["']revoke-bulk-by-user["']\)/);
      expect(src).toMatch(/@Post\(["']revoke-others["']\)/);
    });

    it("every route is gated by @Can('delete', 'Session')", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/sessions-admin.controller.ts"), "utf8");
      // 3 routes × `@Can("delete", "Session")` decorator each.
      const matches = src.match(/@Can\(["']delete["'],\s*["']Session["']\)/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(3);
    });

    it("uses planSessionRevoke from the planner module (not inlined)", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/sessions-admin.controller.ts"), "utf8");
      expect(src).toContain("planSessionRevoke");
      expect(src).toContain('from "./sessions-admin.planner.js"');
    });

    it("revoke-others reads the current session id from the x-session-id header", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/sessions-admin.controller.ts"), "utf8");
      expect(src).toContain('"x-session-id"');
      // The bulk-by-user-except-current strategy is the planner's name.
      expect(src).toContain("bulk-by-user-except-current");
    });
  });

  describe("ImpersonationController", () => {
    it("source defines POST /admin/impersonation/stop", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/impersonation.controller.ts"), "utf8");
      expect(src).toContain('@Controller("admin/impersonation")');
      expect(src).toMatch(/@Post\(["']stop["']\)/);
    });

    it("uses buildImpersonationAuditEvent from the planner (not inlined)", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/impersonation.controller.ts"), "utf8");
      expect(src).toContain("buildImpersonationAuditEvent");
      expect(src).toContain('from "./impersonation.audit.js"');
    });

    it("emits the IMPERSONATION_STOP envelope (kind: 'stop' to the planner)", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/impersonation.controller.ts"), "utf8");
      expect(src).toMatch(/kind:\s*["']stop["']/);
    });

    it("rejects requests missing impersonatedUserId or sessionId with BadRequestException", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/impersonation.controller.ts"), "utf8");
      expect(src).toContain("BadRequestException");
      expect(src).toMatch(/impersonatedUserId.*non-empty string/);
      expect(src).toMatch(/sessionId.*non-empty string/);
    });
  });

  describe("SessionsAdminModule registration", () => {
    it("AppModule registers SessionsAdminModule so the controllers mount", () => {
      const src = readFileSync(resolve(ROOT, "src/core/app/app.module.ts"), "utf8");
      expect(src).toContain("SessionsAdminModule");
      expect(src).toContain('from "../auth/sessions-admin.module.js"');
    });

    it("module exports the four DI tokens for the project to override", () => {
      const src = readFileSync(resolve(ROOT, "src/core/auth/sessions-admin.module.ts"), "utf8");
      expect(src).toContain("SESSION_REVOKE_STORAGE");
      expect(src).toContain("SESSION_REVOKE_AUDIT_SINK");
      expect(src).toContain("IMPERSONATION_AUDIT_SINK");
      expect(src).toContain("IMPERSONATION_TEARDOWN");
    });
  });
});
