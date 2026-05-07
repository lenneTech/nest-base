import { describe, expect, it } from "vitest";

import { CORE_AUDITABLE_MODELS } from "../../src/core/prisma/prisma.service.js";
import { EXTRA_AUDITABLE_MODELS } from "../../src/core/prisma/prisma-tokens.js";

/**
 * Story · EXTRA_AUDITABLE_MODELS injection token
 *
 * Project modules can register
 *   `{ provide: EXTRA_AUDITABLE_MODELS, useValue: ["Todo"] }`
 * without touching `src/core/prisma/prisma.service.ts`. This story
 * verifies the token shape and that `CORE_AUDITABLE_MODELS` is
 * non-empty (ensuring the default opt-in stays intact).
 *
 * The runtime merging (`[...CORE_AUDITABLE_MODELS, ...extraAuditableModels]`)
 * happens in `PrismaService.buildExtendedClient()` which is exercised
 * by `audit-extension-default-models.story.test.ts` with a real DB.
 * This story is intentionally pure — no Postgres, no NestJS bootstrap.
 */
describe("Story · EXTRA_AUDITABLE_MODELS injection token", () => {
  it("EXTRA_AUDITABLE_MODELS is the expected string token", () => {
    expect(EXTRA_AUDITABLE_MODELS).toBe("EXTRA_AUDITABLE_MODELS");
  });

  it("CORE_AUDITABLE_MODELS contains at least the governance models", () => {
    // These are the models the PRD pins as always-audited (CF.AUDIT.02).
    expect(CORE_AUDITABLE_MODELS).toContain("Organization");
    expect(CORE_AUDITABLE_MODELS).toContain("Member");
    expect(CORE_AUDITABLE_MODELS).toContain("Role");
    expect(CORE_AUDITABLE_MODELS).toContain("ApiKey");
    // Better-Auth internals must NOT be in the default list (their
    // churn would dwarf audit-log volume with zero compliance value).
    expect(CORE_AUDITABLE_MODELS).not.toContain("Session");
    expect(CORE_AUDITABLE_MODELS).not.toContain("Account");
    expect(CORE_AUDITABLE_MODELS).not.toContain("Verification");
  });

  it("merging CORE_AUDITABLE_MODELS with project extras produces a combined list", () => {
    // Simulate what PrismaService.buildExtendedClient() does at runtime.
    const projectExtras = ["Todo", "Invoice"];
    const merged = [...CORE_AUDITABLE_MODELS, ...projectExtras];
    expect(merged).toContain("Organization");
    expect(merged).toContain("Todo");
    expect(merged).toContain("Invoice");
    // No duplicates introduced by the spread.
    const unique = new Set(merged);
    expect(unique.size).toBe(merged.length);
  });

  it("merging with an empty extras list leaves CORE_AUDITABLE_MODELS unchanged", () => {
    const merged = [...CORE_AUDITABLE_MODELS, ...([] as string[])];
    expect(merged).toEqual([...CORE_AUDITABLE_MODELS]);
  });
});
