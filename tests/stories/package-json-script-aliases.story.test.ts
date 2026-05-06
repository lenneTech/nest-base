import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · package.json script aliases required by the PRD's six quality gates.
 *
 * The PRD's `SC.QG.*` table calls each gate by its canonical command:
 *   bun run lint
 *   bun run format:check
 *   bun run test:types
 *   bun run test:unit
 *   bun run test:e2e
 *   bun run test:coverage
 *   bun run build
 *
 * Two of those names diverged in the existing codebase: `format` was the
 * check variant (rather than `format:check`) and `format:fix` was the
 * mutator. To preserve the PRD's quality-gate command line verbatim
 * (matched by `scripts/verify-spec.sh` and downstream CI), we expose
 * both names — `format` stays as the legacy alias, `format:check`
 * is added so the PRD's command line works as written.
 */

interface PackageJson {
  scripts: Record<string, string>;
}

function readPackageJson(): PackageJson {
  const path = join(process.cwd(), "package.json");
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as PackageJson;
}

describe("Story · package.json gate-name aliases", () => {
  it("exposes format:check as a callable bun script", () => {
    const pkg = readPackageJson();
    expect(pkg.scripts["format:check"]).toBeDefined();
    expect(pkg.scripts["format:check"]).toMatch(/oxfmt/);
    expect(pkg.scripts["format:check"]).toMatch(/--check/);
  });

  it("keeps format as the legacy alias for the same operation", () => {
    const pkg = readPackageJson();
    expect(pkg.scripts.format).toBeDefined();
  });

  it("keeps format:fix as the mutator", () => {
    const pkg = readPackageJson();
    expect(pkg.scripts["format:fix"]).toBeDefined();
    expect(pkg.scripts["format:fix"]).toMatch(/oxfmt/);
    expect(pkg.scripts["format:fix"]).not.toMatch(/--check/);
  });

  it("exposes every gate command from the PRD's SC.QG table", () => {
    const pkg = readPackageJson();
    const required = [
      "lint",
      "format:check",
      "test:types",
      "test:unit",
      "test:e2e",
      "test:coverage",
      "build",
    ];
    for (const script of required) {
      expect(pkg.scripts[script], `missing required script: ${script}`).toBeDefined();
    }
  });
});
