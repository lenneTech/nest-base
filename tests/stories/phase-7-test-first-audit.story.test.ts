import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Phase 7 Test-First audit (PLAN.md §32 Phase 7).
 *
 * The Phase 7 Test-First entry promises four story files cover the
 * phase's load-bearing surfaces — Setup-Wizard idempotency,
 * Schema-Concat (only active features combined), sync:from-template
 * (src/modules/ untouched), sync:to-template (correct patch from
 * src/core/ diff). Iterations 66–69 wrote and shipped each story.
 *
 * This audit pins file path AND describe-block fragment so a
 * "rename-only" change still wakes the regression guard — the test
 * name is part of the contract, not just the file presence.
 */
describe("Story · Phase 7 Test-First audit", () => {
  const REQUIRED: Array<{ surface: string; file: string; describeFragment: string }> = [
    {
      surface: "Setup-Wizard (idempotency, .env output, abortable)",
      file: "tests/stories/setup-wizard.story.test.ts",
      describeFragment: "Setup-Wizard",
    },
    {
      surface: "Schema-Concat (only active features combined)",
      file: "tests/stories/schema-concat.story.test.ts",
      describeFragment: "Schema-Concat",
    },
    {
      surface: "sync:from-template (src/modules/ untouched)",
      file: "tests/stories/sync-from-template.story.test.ts",
      describeFragment: "sync:from-template",
    },
    {
      surface: "sync:to-template (correct patch from src/core/ diff)",
      file: "tests/stories/sync-to-template.story.test.ts",
      describeFragment: "sync:to-template",
    },
  ];

  for (const entry of REQUIRED) {
    it(`covers "${entry.surface}" via ${entry.file}`, () => {
      const full = resolve(ROOT, entry.file);
      expect(existsSync(full), `${entry.file} must exist`).toBe(true);
      const content = readFileSync(full, "utf8");
      expect(content).toMatch(
        new RegExp(`describe\\([\\s\\S]*?${escapeRegex(entry.describeFragment)}`),
      );
    });
  }

  it("all four required stories are present (no count drift)", () => {
    expect(REQUIRED).toHaveLength(4);
  });
});

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
