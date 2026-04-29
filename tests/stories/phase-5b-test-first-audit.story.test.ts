import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Phase 5b Test-First audit (PLAN.md §32 Phase 5b).
 *
 * Phase 5b's Test-First entry promises five story files cover the
 * load-bearing PowerSync surfaces — Sync-Rules ⊆ READ-Permissions,
 * Better-Auth-JWT (audience: powersync) + JWKS, Upload-Controller-
 * Conflict-Resolution, Encrypted-Fields-Exclusion, Tenant-Bucket-
 * Isolation.
 */
describe("Story · Phase 5b Test-First audit", () => {
  const REQUIRED: Array<{ surface: string; file: string; describeFragment: string }> = [
    {
      surface: "Sync-Rules ⊆ READ-Permissions + Tenant-Bucket-Isolation",
      file: "tests/stories/powersync-sync-rules.story.test.ts",
      describeFragment: "PowerSync sync-rules.yaml",
    },
    {
      surface: "Better-Auth-JWT mit audience: powersync + JWKS-Verify",
      file: "tests/stories/powersync-jwt-plugin.story.test.ts",
      describeFragment: "Better-Auth JWT plugin for PowerSync",
    },
    {
      surface: "Upload-Controller-Konflikt-Resolution",
      file: "tests/stories/powersync-conflict-resolution.story.test.ts",
      describeFragment: "PowerSync conflict resolution",
    },
    {
      surface: "Encrypted-Fields-Exclusion aus Sync-Buckets",
      file: "tests/stories/powersync-encrypted-exclusion.story.test.ts",
      describeFragment: "Encrypted-Fields excluded from PowerSync sync-rules",
    },
    {
      surface: "Demo-Client + Upload-Backend round-trip (covers tenant-bucket flow)",
      file: "tests/stories/powersync-demo-client-upload.story.test.ts",
      describeFragment: "PowerSync demo client",
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

  it("all five required stories are present (no count drift)", () => {
    expect(REQUIRED).toHaveLength(5);
  });
});

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
