import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · `bun run docs:screenshots` covers every dev-portal route
 * (SC.DX — iter-96 review Finding 18).
 *
 * The PRD pins SC.DX: "bun run docs:screenshots reproduces every
 * dev-portal page without unexpected pixel diffs". Iter-103 surfaced
 * that the script's PAGES list covered ~10 of ~25 routes; this test
 * locks the 1:1 correspondence between `<Route>` declarations in
 * `src/core/dx/clients/App.tsx` and the `PAGES` array in
 * `scripts/take-showcase-screenshots.ts`. Adding a new route forces
 * adding a screenshot entry (and vice-versa).
 *
 * The test parses both files via simple regex — no React rendering —
 * so it stays fast + deterministic.
 */
const ROOT = resolve(__dirname, "..", "..");

function parseAppRoutes(): string[] {
  const src = readFileSync(resolve(ROOT, "src/core/dx/clients/App.tsx"), "utf8");
  const pattern = /<Route\s+path="([^"]+)"/g;
  const routes: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src)) !== null) {
    if (match[1]) routes.push(match[1]);
  }
  // Filter route placeholders that aren't real renderable pages.
  return routes.filter((r) => r !== "*" && !r.includes(":"));
}

function parseScreenshotPaths(): string[] {
  const src = readFileSync(resolve(ROOT, "scripts/take-showcase-screenshots.ts"), "utf8");
  const pattern = /\bpath:\s*"([^"]+)"/g;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(src)) !== null) {
    if (match[1] && match[1].startsWith("/")) paths.push(match[1]);
  }
  return paths;
}

describe("Story · docs:screenshots covers every App.tsx route", () => {
  it("PAGES list covers every concrete <Route path>", () => {
    const routes = parseAppRoutes();
    const screenshots = parseScreenshotPaths();
    const missing = routes.filter((r) => !screenshots.includes(r));
    expect(missing).toEqual([]);
  });

  it("every screenshot path corresponds to a real route in App.tsx", () => {
    const routes = parseAppRoutes();
    const screenshots = parseScreenshotPaths();
    // Allow extra public-catalogue routes (e.g. `/api/openapi`) that
    // ship via Nest controllers, not React routes. Only fail if a
    // dev-portal /hub/* or /hub/admin/* path is missing from App.tsx.
    const orphans = screenshots.filter(
      (s) => (s.startsWith("/hub") || s.startsWith("/hub/admin")) && !routes.includes(s),
    );
    expect(orphans).toEqual([]);
  });

  it("PAGES count is at least 25 (covers the dev-portal surface)", () => {
    const screenshots = parseScreenshotPaths();
    expect(screenshots.length).toBeGreaterThanOrEqual(25);
  });
});
