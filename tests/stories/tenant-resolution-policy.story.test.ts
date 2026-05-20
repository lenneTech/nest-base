import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const POLICY_PATH = resolve(
  import.meta.dirname,
  "../../src/core/multi-tenancy/tenant-resolution-policy.ts",
);

describe("Story · tenant resolution policy", () => {
  it("documents session-only tenant scope (no x-tenant-id header override)", () => {
    const text = readFileSync(POLICY_PATH, "utf8");
    expect(text).toContain("activeOrganizationId");
    expect(text).toMatch(/x-tenant-id.*no longer read/i);
    expect(text).toContain("organization/set-active");
  });
});
