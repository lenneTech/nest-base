import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · `bun run test:e2e` accepts a path-filter argument.
 *
 * QUICKSTART.md ("TDD cycle template") and CLAUDE.md ("Boot a TDD slice")
 * both promise that you can run a single failing story test by writing
 * `bun run test:e2e tests/stories/<file>.story.test.ts`. That contract
 * is broken if the script bakes positional vitest filename-patterns into
 * the command, because vitest unions the bake-in patterns with the user
 * supplied argv → the whole suite runs (~minutes) instead of the one
 * file (~seconds).
 *
 * Convention: `vitest.config.ts` already includes
 * `tests/**\/*.{spec,test,e2e-spec,story.test}.ts` and excludes
 * `tests/unit` is selected via the dedicated `test:unit` script.
 * The simplest correct script therefore omits filename patterns
 * entirely and lets the include glob do its job. A user-supplied path
 * narrows the run; an empty argv runs the configured set.
 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const PACKAGE_JSON = resolve(REPO_ROOT, "package.json");

describe("Story · test:e2e accepts a path-filter argument", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")) as {
    scripts: Record<string, string>;
  };
  const script = pkg.scripts["test:e2e"];

  it("the test:e2e script is present", () => {
    expect(script).toBeDefined();
  });

  it("invokes vitest with --passWithNoTests but no positional filename patterns", () => {
    // Positional args after `vitest run` are filename-substring patterns.
    // Adding `e2e-spec` / `stories` makes vitest union them with whatever
    // the user appends, defeating path-filtering. The correct form is
    // either `vitest run --passWithNoTests` (no positional pattern) or
    // a single root-directory argument like `vitest run --passWithNoTests tests`.
    expect(script).toMatch(/^vitest run/);
    expect(script).toContain("--passWithNoTests");
    expect(script).not.toMatch(/\be2e-spec\b/);
    expect(script).not.toMatch(/\bstories\b/);
  });

  it("does not pass any literal path-fragment that would broaden the test run", () => {
    // Allow only well-known vitest flags + at most a single `tests` root.
    // The intent is: appending `bun run test:e2e tests/stories/foo.story.test.ts`
    // must result in vitest narrowing to that file, not unioning it with
    // a hard-coded pattern.
    const tokens = script.split(/\s+/).slice(2); // drop "vitest run"
    for (const token of tokens) {
      if (token === "--passWithNoTests") continue;
      if (token === "tests") continue;
      // Any other token is suspect — fail loudly so the maintainer has
      // to update this story (and reconsider the contract).
      throw new Error(
        `Unexpected token in test:e2e script: "${token}". Adding a filename pattern here breaks path-filtering. Update this story if the contract changes.`,
      );
    }
    expect(true).toBe(true);
  });
});
