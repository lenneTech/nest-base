import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · `docs/security.md` freshness check (PRD line 414, iter-150).
 *
 * The PRD pins the security doc as Phase 3's substantive contract
 * triad: secret-management boundary, RLS contract, output-pipeline
 * guarantees. Drift between the doc and the code (renamed file path,
 * deleted symbol, moved interceptor) silently lies to readers — the
 * only failure mode that matters for a contract document. This story
 * grep-asserts a representative path from each section so the doc
 * can't claim to anchor symbols that no longer exist.
 *
 * Adding a section to docs/security.md? Add an anchor here. Removing
 * a path from the doc? Remove the matching anchor. The story is the
 * doc's CI gate.
 */
describe("Story · docs/security.md anchors current source paths", () => {
  const projectRoot = resolve(import.meta.dirname, "..", "..");
  const securityDoc = resolve(projectRoot, "docs", "security.md");

  function readSecurityDoc(): string {
    return readFileSync(securityDoc, "utf8");
  }

  it("docs/security.md exists at the project's docs root", () => {
    expect(existsSync(securityDoc)).toBe(true);
  });

  it("references the three contract triads named in PRD line 414", () => {
    const text = readSecurityDoc();
    expect(text).toMatch(/Secret-management boundary/i);
    expect(text).toMatch(/RLS contract/i);
    expect(text).toMatch(/Output-pipeline guarantees/i);
  });

  describe("anchors point at files that exist", () => {
    const anchors = [
      "src/core/auth/better-auth.ts",
      "src/core/encryption/multi-kek.service.ts",
      "src/core/encryption/blind-index.ts",
      "src/core/webhooks/hmac-signature.ts",
      "src/core/prisma/prisma.service.ts",
      "src/core/setup/env-prerequisites.ts",
      "src/core/multi-tenancy/tenant-guard.ts",
      "src/core/multi-tenancy/resolve-request-tenant.ts",
      "src/core/audit/audit-log.service.ts",
      "src/core/output-pipeline/output-pipeline.ts",
      "src/core/output-pipeline/remove-secrets.ts",
      "src/core/output-pipeline/safety-net.ts",
      "src/core/realtime/inspector-filter.ts",
    ];

    for (const path of anchors) {
      it(`${path} exists`, () => {
        const text = readSecurityDoc();
        // Doc must reference the path so a grep-rename catches it.
        expect(text, `docs/security.md must reference ${path}`).toContain(path);
        // And the file must actually be there.
        expect(existsSync(resolve(projectRoot, path))).toBe(true);
      });
    }
  });

  it("references the four output-pipeline stages by name", () => {
    const text = readSecurityDoc();
    expect(text).toMatch(/CASL field projection/);
    expect(text).toMatch(/Property masking/i);
    expect(text).toMatch(/removeSecrets/);
    expect(text).toMatch(/Safety net/i);
  });

  it("does not reference the legacy GraphQL/Mongoose stack (out-of-scope by PRD)", () => {
    const text = readSecurityDoc();
    expect(text).not.toMatch(/GraphQL/i);
    expect(text).not.toMatch(/Mongoose/i);
    expect(text).not.toMatch(/MongoDB/i);
  });
});
