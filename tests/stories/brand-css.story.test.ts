import { describe, expect, it } from "vitest";

import { BrandConfigSchema } from "../../src/core/branding/brand-schema.js";
import { escapeCssValue, renderBrandCss } from "../../src/core/branding/brand-css.js";

/**
 * Story · Brand-CSS generator.
 *
 * `renderBrandCss(brand)` produces a `:root { ... }` block that
 * defines the design-token CSS variables driven by the active brand.
 * The dev-portal SPA shell injects this block before the static
 * tokens.css so the variable cascade ends with the brand-tinted
 * values.
 *
 * Two safety properties:
 *   1. Determinism — same brand → byte-identical output (no Date.now,
 *      no Math.random). Caching layers can hash the result.
 *   2. CSS-injection safety — `escapeCssValue()` strips characters
 *      that could close a declaration / `<style>` block. Hex colors
 *      are already schema-validated; the safety net here is for
 *      `appName`-style fields that flow into CSS comments.
 */
describe("Story · Brand-CSS generator", () => {
  describe("escapeCssValue", () => {
    it("strips closing-style sequences", () => {
      // `</style>` inside a CSS string would terminate the surrounding
      // `<style>` block in HTML. The escaper must drop the `<` and `>`
      // so `<script>` cannot reconstitute itself.
      const out = escapeCssValue("</style><script>alert(1)</script>");
      expect(out).not.toContain("<");
      expect(out).not.toContain(">");
      expect(out).not.toContain("</");
      expect(out).not.toContain("<script");
    });

    it("strips characters that break CSS declarations", () => {
      const out = escapeCssValue("red; background: url(javascript:alert(1))");
      expect(out).not.toContain(";");
      expect(out).not.toContain("(");
      expect(out).not.toContain(")");
    });

    it("preserves alphanumerics, dashes, dots, and #", () => {
      const out = escapeCssValue("Acme-Brand 1.0 #c5fb45");
      expect(out).toBe("Acme-Brand 1.0 #c5fb45");
    });

    it("strips backslashes (CSS escape sequences)", () => {
      const out = escapeCssValue("foo\\3c bar");
      expect(out).not.toContain("\\");
    });
  });

  describe("renderBrandCss", () => {
    it("emits a :root block with the seven core color tokens", () => {
      const brand = BrandConfigSchema.parse({ name: "x" });
      const css = renderBrandCss(brand);
      expect(css).toContain(":root");
      expect(css).toContain("--accent: #c5fb45");
      expect(css).toContain("--accent-ink: #0a0a0a");
      expect(css).toContain("--bg: #020203");
      expect(css).toContain("--surface-1: #06070a");
      expect(css).toContain("--fg: #e4e4e7");
      expect(css).toContain("--fg-dim: #71717a");
    });

    it("propagates a custom primary color", () => {
      const brand = BrandConfigSchema.parse({ name: "x", primaryColor: "#ff00aa" });
      const css = renderBrandCss(brand);
      expect(css).toContain("--accent: #ff00aa");
    });

    it("is wrapped in a <style> element when wrap='style' is requested", () => {
      const brand = BrandConfigSchema.parse({ name: "x" });
      const css = renderBrandCss(brand, { wrap: "style" });
      expect(css.startsWith("<style")).toBe(true);
      expect(css.endsWith("</style>")).toBe(true);
      expect(css).toContain(":root");
    });

    it("is deterministic — same brand returns byte-identical output", () => {
      const brand = BrandConfigSchema.parse({ name: "x", primaryColor: "#abc123" });
      expect(renderBrandCss(brand)).toBe(renderBrandCss(brand));
    });

    it("escapes injection attempts in the brand name (used in comment)", () => {
      const brand = BrandConfigSchema.parse({ name: "</style><script>alert(1)</script>" });
      const css = renderBrandCss(brand, { wrap: "style" });
      // The brand name appears in a CSS comment header — escapeCssValue
      // strips angle brackets so the surrounding <style> block can't
      // be closed prematurely.
      expect(css).not.toContain("<script>");
      expect(css).not.toContain("</style><script");
    });

    it("emits accent-soft + accent-glow rgba derived from primaryColor", () => {
      const brand = BrandConfigSchema.parse({ name: "x", primaryColor: "#ff00aa" });
      const css = renderBrandCss(brand);
      // rgba derivation matches the existing tokens.css convention
      // (0.12 alpha for soft, 0.35 for glow).
      expect(css).toContain("--accent-soft: rgba(255, 0, 170, 0.12)");
      expect(css).toContain("--accent-glow: rgba(255, 0, 170, 0.35)");
    });
  });
});
