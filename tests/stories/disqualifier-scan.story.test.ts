import { describe, expect, it } from "vitest";

/**
 * Story · Context-aware disqualifier scan (LOOP.DISQ.01 closure —
 * iter-212).
 *
 * Iter-205's `docs/prd-deviations.md` documented LOOP.DISQ.01: the
 * Ralph loop's bare-word `(stub|placeholder|NotImplemented)` regex
 * generated 79 hits in `src/`, every single one a false positive
 * (HTML form attributes, Tailwind utility variants, doc-comments,
 * test-double terminology, sentinel-string variables).
 *
 * Iter-212 closes the gap with `scripts/disqualifier-scan.ts`: a
 * context-aware scanner that filters out:
 *   - HTML `placeholder=` attributes
 *   - Tailwind `placeholder:` utility variants
 *   - JSDoc / inline comments
 *   - Component prop types and JSX prop assignments
 *   - Sentinel-string variable declarations
 *   - Test-double "stub" terminology (xUnit-style)
 *   - Surface-text mentions inside string literals
 *   - Markdown documentation files
 *
 * Actionable patterns (TODO/FIXME/XXX, TS escape hatches,
 * NotImplemented, console.log in src, etc.) are still surfaced as-is.
 */
describe("Story · Context-aware disqualifier scan (LOOP.DISQ.01 — iter-212)", () => {
  it("scripts/disqualifier-scan.ts exists and is invocable via package.json", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["check:disqualifiers"]).toContain("scripts/disqualifier-scan.ts");
    const scanSrc = readFileSync("scripts/disqualifier-scan.ts", "utf8");
    expect(scanSrc).toContain("ACTIONABLE_PATTERNS");
    expect(scanSrc).toContain("CONTEXTUAL_PATTERNS");
    expect(scanSrc).toContain("isFalsePositive");
  });

  it("the scan recognises HTML placeholder= attributes as false positives", async () => {
    const { readFileSync } = await import("node:fs");
    const scanSrc = readFileSync("scripts/disqualifier-scan.ts", "utf8");
    expect(scanSrc).toMatch(/\\bplaceholder\\s\*=\\s\*\["'`\]/);
  });

  it("the scan recognises Tailwind placeholder: utility variants as false positives", async () => {
    const { readFileSync } = await import("node:fs");
    const scanSrc = readFileSync("scripts/disqualifier-scan.ts", "utf8");
    expect(scanSrc).toMatch(/placeholder:\[a-z-\]\+/);
  });

  it("the scan recognises JSDoc / inline comment lines as false positives", async () => {
    const { readFileSync } = await import("node:fs");
    const scanSrc = readFileSync("scripts/disqualifier-scan.ts", "utf8");
    expect(scanSrc).toMatch(/trimmed\.startsWith\("\*"\)/);
    expect(scanSrc).toMatch(/trimmed\.startsWith\("\/\/"\)/);
  });

  it("the scan keeps actionable patterns (TODO/FIXME/XXX/as any/@ts-ignore/NotImplemented) as hard fails", async () => {
    const { readFileSync } = await import("node:fs");
    const scanSrc = readFileSync("scripts/disqualifier-scan.ts", "utf8");
    for (const required of [
      "TODO",
      "FIXME",
      "XXX",
      "NotImplemented",
      "as any",
      "as unknown as",
      "@ts-ignore",
      "@ts-expect-error",
    ]) {
      expect(scanSrc).toContain(required);
    }
  });

  it("docs/prd-deviations.md no longer lists LOOP.DISQ.01", async () => {
    const { readFileSync } = await import("node:fs");
    const deviationsSrc = readFileSync("docs/prd-deviations.md", "utf8");
    expect(deviationsSrc).not.toMatch(/^### LOOP\.DISQ\.01/m);
  });
});
