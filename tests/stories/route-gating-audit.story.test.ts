import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { auditControllerRoutes } from "../../src/core/permissions/route-audit-planner.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Route-gating audit (CI gate).
 *
 * Walks every `*.controller.ts` and `*.module.ts` under `src/` and
 * asserts that every HTTP-method decorator carries either:
 *
 *   - `@Can(action, subject)` — permission-gated
 *   - `@Public("<reason>")`   — explicit consent that the route is
 *                               anonymous-by-design (with reason at
 *                               the decoration site)
 *   - or the full path is covered by the jwt-middleware
 *     `PUBLIC_PREFIXES` / `PUBLIC_EXACT` allowlist
 *
 * If a new controller route lands without one of those, this test
 * fails with a precise file:line list — forcing the author to make
 * a deliberate gating choice rather than slipping past the
 * 3-layer permission architecture.
 *
 * See `docs/security/route-audit-2026-05-02.md` for the inventory
 * snapshot that grandfathered the audit clean.
 */
describe("Story · Route-gating audit (CI gate)", () => {
  it("every controller route is @Can(), @Public(), or path-allowlisted", () => {
    const findings = auditControllerRoutes({ root: REPO_ROOT });
    const ungated = findings.filter((f) => f.classification === "ungated-bug");
    if (ungated.length > 0) {
      const list = ungated
        .map(
          (f) =>
            `  - ${f.file}:${f.line}  ${f.method.padEnd(6)} ${f.path}  ` +
            `(${f.controllerClass}.${f.handler})`,
        )
        .join("\n");
      expect.fail(
        `Found ${ungated.length} controller route(s) without @Can(), @Public(), or path-allowlist coverage:\n${list}\n\n` +
          `Fix by adding @Can(action, subject) for permission-gated routes, or @Public("<reason>") ` +
          `for genuinely public routes. See CLAUDE.md "Route gating policy" + Issue #47 for the rule.`,
      );
    }
    expect(ungated).toHaveLength(0);
  });

  it("findings include a non-trivial number of routes (planner is wired)", () => {
    // Belt-and-braces — guards against accidental misconfiguration that
    // would silently report zero ungated routes because the planner
    // simply never ran. We expect at least the Hub + better-auth +
    // health controllers' routes to be picked up.
    const findings = auditControllerRoutes({ root: REPO_ROOT });
    expect(findings.length).toBeGreaterThan(20);
  });
});
