import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { WORKSTATION_SPA_PATH_PREFIXES } from "../../src/core/dx/hub-nav-planner.js";
import {
  WORKSTATION_PAGE_COMPONENTS,
  isWorkstationPageChunk,
} from "../../src/core/dx/workstation-page-chunks.js";

/**
 * Story · workstation surfaces are not DELIVERED outside development.
 *
 * Phase 3 of the Hub consolidation. Hiding nav entries (#187) is not
 * enough — the page code itself must stay on the workstation:
 *
 *   1. the build emits every workstation page as its own NAMED entry
 *      chunk (`CoveragePage.js`, `FeaturesPage.js`, …) so the server
 *      has a deterministic chunk↔page mapping without parsing bundles
 *   2. `main.js` lazy-imports exactly those named files, so refusing
 *      them refuses the page code (shared/operational chunks keep
 *      their anonymous `chunk-<hash>.js` names and stay servable)
 *   3. the SPA router registers workstation routes ONLY when
 *      `portal-access.json → workstation === true`; outside dev the
 *      router doesn't know them, deep links land on the SPA not-found
 *      view and the chunks are never requested
 *
 * Serving behaviour (dev 200 / prod 404) is pinned in the env-bound
 * stories: `hub-outside-dev-development` (dev invariance) and
 * `hub-outside-dev` (production + flag). This file locks the
 * mechanism: list ↔ build ↔ bundle ↔ router.
 */

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const DIST = resolve(REPO_ROOT, "dist/dev-portal");

function read(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), "utf8");
}

describe("Story · workstation page chunks (build mechanism + SPA router tiers)", () => {
  describe("shared chunk list", () => {
    it("covers exactly the nine workstation pages", () => {
      expect([...WORKSTATION_PAGE_COMPONENTS].sort()).toEqual(
        [
          "CoveragePage",
          "EmailBuilderPage",
          "ErdPage",
          "FeaturesPage",
          "FileManagerPage",
          "MigrationsPage",
          "PermissionTesterPage",
          "SearchTesterPage",
          "TestsPage",
        ].sort(),
      );
    });

    it("classifies the emitted chunk filenames, nothing else", () => {
      expect(isWorkstationPageChunk("CoveragePage.js")).toBe(true);
      expect(isWorkstationPageChunk("FeaturesPage.js")).toBe(true);
      expect(isWorkstationPageChunk("main.js")).toBe(false);
      expect(isWorkstationPageChunk("chunk-abc123.js")).toBe(false);
      expect(isWorkstationPageChunk("tokens.css")).toBe(false);
      expect(isWorkstationPageChunk("LogsPage.js")).toBe(false);
    });

    it("the features page counts as workstation (consolidation phase 3)", () => {
      expect(WORKSTATION_SPA_PATH_PREFIXES).toContain("/hub/features");
      expect(WORKSTATION_PAGE_COMPONENTS).toContain("FeaturesPage");
    });
  });

  describe("build output (run `bun run build:dev-portal` first — global-setup does)", () => {
    it("emits every workstation page as a named entry chunk", () => {
      for (const component of WORKSTATION_PAGE_COMPONENTS) {
        expect(existsSync(resolve(DIST, `${component}.js`)), `${component}.js missing`).toBe(true);
      }
    });

    it("main.js lazy-imports the named workstation files (mapping is real, not cosmetic)", () => {
      const main = readFileSync(resolve(DIST, "main.js"), "utf8");
      for (const component of WORKSTATION_PAGE_COMPONENTS) {
        expect(
          main.includes(`./${component}.js`),
          `main.js does not reference ${component}.js`,
        ).toBe(true);
      }
    });

    it("build script derives the extra entrypoints from the shared list", () => {
      const script = read("scripts/build-dev-portal.ts");
      expect(script).toContain("WORKSTATION_PAGE_COMPONENTS");
    });

    it("the static handler consults the same list", () => {
      const controller = read("src/core/dx/hub.controller.ts");
      expect(controller).toContain("isWorkstationPageChunk");
    });
  });

  describe("SPA router registers workstation routes conditionally", () => {
    const APP = read("src/core/dx/clients/App.tsx");

    it("declares a WORKSTATION_ROUTES table guarded by the portal-access workstation flag", () => {
      expect(APP).toContain("WORKSTATION_ROUTES");
      expect(APP).toMatch(/workstation[A-Za-z]*\s*\?\s*WORKSTATION_ROUTES\s*:/);
    });

    it("every workstation SPA path is registered ONLY inside the workstation table", () => {
      const wsBlock = APP.slice(
        APP.indexOf("WORKSTATION_ROUTES"),
        APP.indexOf("export function App"),
      );
      const appBlock = APP.slice(APP.indexOf("export function App"));
      for (const path of WORKSTATION_SPA_PATH_PREFIXES) {
        expect(wsBlock.includes(`path="${path}"`), `${path} missing from WORKSTATION_ROUTES`).toBe(
          true,
        );
        expect(
          appBlock.includes(`path="${path}"`),
          `${path} must not be registered unconditionally`,
        ).toBe(false);
      }
    });

    it("unmatched portal paths land on the SPA not-found view", () => {
      expect(APP).toMatch(/<Route\s+path="\*"/);
    });
  });

  describe("nav + palette treat Features as workstation tier", () => {
    it("nav.ts tags the features item", () => {
      const nav = read("src/core/dx/clients/layout/nav.ts");
      expect(nav).toMatch(/id: "features"[^}]*tier: "workstation"/s);
    });
  });
});
