import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Repo-Layout — strict 3-way split:
 *   - src/core/    template-owned, syncs in via `bun run sync:from-template`,
 *                  syncs back via `bun run sync:to-template`
 *   - src/modules/ project-owned, NEVER part of the template-sync
 *   - src/shared/  shared types (channel constants, event schemas),
 *                  published with the kubb SDK
 *
 * Tests pin the directory split + the tsconfig path-aliases that make
 * `@core`/`@modules`/`@shared` discoverable from any source file.
 */
describe("Repo Layout", () => {
  const dirs = ["src/core", "src/modules", "src/shared"] as const;

  it.each(dirs)("%s exists as a directory", (dir) => {
    const path = resolve(ROOT, dir);
    expect(existsSync(path), `${dir} missing`).toBe(true);
    expect(statSync(path).isDirectory()).toBe(true);
  });

  it("tsconfig.json declares path aliases for @core / @modules / @shared", () => {
    const tsconfig = JSON.parse(readFileSync(resolve(ROOT, "tsconfig.json"), "utf8")) as {
      compilerOptions?: { paths?: Record<string, string[]> };
    };
    const paths = tsconfig.compilerOptions?.paths ?? {};
    // TypeScript 7 removed `baseUrl` and requires path-mapping targets
    // to be relative (leading `./`) to the tsconfig directory.
    expect(paths["@core/*"]).toEqual(["./src/core/*"]);
    expect(paths["@modules/*"]).toEqual(["./src/modules/*"]);
    expect(paths["@shared/*"]).toEqual(["./src/shared/*"]);
  });

  it("vitest.config.ts mirrors the same aliases for test resolution", () => {
    const cfg = readFileSync(resolve(ROOT, "vitest.config.ts"), "utf8");
    expect(cfg).toMatch(/'@core'/);
    expect(cfg).toMatch(/'@modules'/);
    expect(cfg).toMatch(/'@shared'/);
  });

  it("README documents the layout split (core / modules / shared)", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    expect(readme).toMatch(/\bcore\//);
    expect(readme).toMatch(/\bmodules\//);
    expect(readme).toMatch(/\bshared\//);
  });

  it("src/modules has a placeholder so the directory survives a clean checkout", () => {
    expect(existsSync(resolve(ROOT, "src/modules/.gitkeep"))).toBe(true);
  });

  it("src/shared exposes a barrel `index.ts` (entry-point for SDK publish)", () => {
    expect(existsSync(resolve(ROOT, "src/shared/index.ts"))).toBe(true);
  });
});
