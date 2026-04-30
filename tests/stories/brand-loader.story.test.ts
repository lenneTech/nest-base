import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadBrandSync,
  planBrandLoad,
  resolveBrandPaths,
  __clearBrandCache,
} from "../../src/core/branding/brand-loader.js";

/**
 * Story · Brand-Loader.
 *
 * The loader reads the effective brand config from disk:
 *   1. project-owned override at `src/modules/branding/brand.json`
 *   2. fallback to template default at `src/core/branding/brand.default.json`
 *   3. ultimate fallback to the schema's built-in defaults
 *
 * The pure planner `planBrandLoad({ overlay, defaultJson })` does the
 * merge logic and is fully testable without I/O. The runner
 * `loadBrandSync(root)` walks the file system and feeds the planner.
 *
 * The result is cached so the dev-portal SPA shell, OpenAPI builder,
 * and email service all see the same Brand without re-reading the
 * JSON on every request. `__clearBrandCache()` is exposed for tests
 * and for the dev `.env`-watcher style hot-reload trigger.
 */
describe("Story · Brand-Loader", () => {
  describe("planBrandLoad (pure planner)", () => {
    it("uses overlay when supplied (overlay wins)", () => {
      const result = planBrandLoad({
        overlay: { name: "ProjectName", primaryColor: "#ff00aa" },
        defaultJson: { name: "TemplateDefault" },
      });
      expect(result.brand.name).toBe("ProjectName");
      expect(result.brand.primaryColor).toBe("#ff00aa");
      expect(result.source).toBe("overlay");
    });

    it("falls back to defaultJson when overlay is null", () => {
      const result = planBrandLoad({
        overlay: null,
        defaultJson: { name: "TemplateDefault", primaryColor: "#abcdef" },
      });
      expect(result.brand.name).toBe("TemplateDefault");
      expect(result.brand.primaryColor).toBe("#abcdef");
      expect(result.source).toBe("default");
    });

    it("falls back to schema built-ins when both inputs are null", () => {
      // Worst-case fallback — should still produce a valid BrandConfig
      // so first-boot before any JSON exists never crashes.
      const result = planBrandLoad({ overlay: null, defaultJson: null });
      expect(result.brand.name).toBeTruthy();
      expect(result.brand.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(result.source).toBe("builtin");
    });

    it("validates overlay through BrandConfigSchema (rejects bad hex)", () => {
      expect(() =>
        planBrandLoad({
          overlay: { name: "x", primaryColor: "not-a-color" },
          defaultJson: null,
        }),
      ).toThrow();
    });

    it("validates defaultJson when overlay is null", () => {
      expect(() =>
        planBrandLoad({
          overlay: null,
          defaultJson: { name: "" }, // empty name → schema reject
        }),
      ).toThrow();
    });
  });

  describe("resolveBrandPaths", () => {
    it("computes overlay + default paths from a project root", () => {
      const paths = resolveBrandPaths("/some/root");
      expect(paths.overlayPath).toBe("/some/root/src/modules/branding/brand.json");
      expect(paths.defaultPath).toBe("/some/root/src/core/branding/brand.default.json");
    });
  });

  describe("loadBrandSync (runner)", () => {
    let dir: string;

    beforeEach(() => {
      __clearBrandCache();
      dir = mkdtempSync(join(tmpdir(), "brand-loader-"));
      mkdirSync(join(dir, "src/core/branding"), { recursive: true });
      mkdirSync(join(dir, "src/modules/branding"), { recursive: true });
    });

    afterEach(() => {
      __clearBrandCache();
      rmSync(dir, { recursive: true, force: true });
    });

    it("reads project overlay when present", () => {
      writeFileSync(
        join(dir, "src/modules/branding/brand.json"),
        JSON.stringify({ name: "Acme Corp", primaryColor: "#ff00aa" }),
      );
      writeFileSync(
        join(dir, "src/core/branding/brand.default.json"),
        JSON.stringify({ name: "DefaultTemplate" }),
      );

      const brand = loadBrandSync(dir);
      expect(brand.name).toBe("Acme Corp");
      expect(brand.primaryColor).toBe("#ff00aa");
    });

    it("falls back to brand.default.json when no overlay exists", () => {
      writeFileSync(
        join(dir, "src/core/branding/brand.default.json"),
        JSON.stringify({ name: "TemplateDefault", primaryColor: "#abcdef" }),
      );

      const brand = loadBrandSync(dir);
      expect(brand.name).toBe("TemplateDefault");
      expect(brand.primaryColor).toBe("#abcdef");
    });

    it("returns schema defaults when neither file exists", () => {
      const brand = loadBrandSync(dir);
      expect(brand.name).toBeTruthy();
      expect(brand.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it("caches the loaded result by project root", () => {
      writeFileSync(
        join(dir, "src/core/branding/brand.default.json"),
        JSON.stringify({ name: "First" }),
      );
      const a = loadBrandSync(dir);

      // Second call with same root — should return the cached value
      // even though we change the underlying file. The dev-runner
      // explicitly calls __clearBrandCache() when brand.json changes.
      writeFileSync(
        join(dir, "src/core/branding/brand.default.json"),
        JSON.stringify({ name: "Second" }),
      );
      const b = loadBrandSync(dir);

      expect(a.name).toBe("First");
      expect(b.name).toBe("First");
    });

    it("re-reads after __clearBrandCache()", () => {
      writeFileSync(
        join(dir, "src/core/branding/brand.default.json"),
        JSON.stringify({ name: "First" }),
      );
      loadBrandSync(dir);

      writeFileSync(
        join(dir, "src/core/branding/brand.default.json"),
        JSON.stringify({ name: "Second" }),
      );
      __clearBrandCache();
      const refreshed = loadBrandSync(dir);
      expect(refreshed.name).toBe("Second");
    });

    it("throws a clear error on malformed overlay JSON", () => {
      writeFileSync(join(dir, "src/modules/branding/brand.json"), "{ not json");
      expect(() => loadBrandSync(dir)).toThrow(/brand\.json/);
    });

    it("throws when overlay JSON fails schema validation", () => {
      writeFileSync(
        join(dir, "src/modules/branding/brand.json"),
        JSON.stringify({ primaryColor: "not-hex" }),
      );
      expect(() => loadBrandSync(dir)).toThrow();
    });
  });
});
