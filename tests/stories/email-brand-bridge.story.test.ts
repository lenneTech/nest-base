import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { __clearBrandCache } from "../../src/core/branding/brand-loader.js";
import {
  brandConfigFromCentral,
  defaultBrandConfig,
  resolveBrandConfig,
} from "../../src/core/email/brand.js";

/**
 * Story · Email-Brand bridge.
 *
 * `src/core/email/brand.ts` is the email subsystem's view of the
 * brand — historically owned by issue #6, now re-exporting the
 * central brand from `src/core/branding/` while keeping the email
 * flavour (`appName`, derived from `name`).
 *
 * Two seams matter for this slice:
 *
 *   - `defaultBrandConfig()` reads from the central brand-loader so
 *     the email service follows the same `brand.json` the dev-portal
 *     and OpenAPI builder use.
 *
 *   - `brandConfigFromCentral(brand)` adapts a central `BrandConfig`
 *     to the email-flavored shape. Pure helper; lets callers (e.g.
 *     EmailModule) compose the value from a typed `BrandConfig`
 *     instead of re-walking the disk.
 */
describe("Story · Email ↔ central brand bridge", () => {
  describe("defaultBrandConfig sources from disk", () => {
    let dir: string;
    let originalCwd: string;

    beforeEach(() => {
      __clearBrandCache();
      dir = mkdtempSync(join(tmpdir(), "email-brand-"));
      mkdirSync(join(dir, "src/core/branding"), { recursive: true });
      mkdirSync(join(dir, "src/modules/branding"), { recursive: true });
      originalCwd = process.cwd();
      process.chdir(dir);
    });

    afterEach(() => {
      process.chdir(originalCwd);
      __clearBrandCache();
      rmSync(dir, { recursive: true, force: true });
    });

    it("uses the project overlay's `name` as the email `appName`", () => {
      writeFileSync(
        join(dir, "src/modules/branding/brand.json"),
        JSON.stringify({ name: "Acme Co", primaryColor: "#ff0000" }),
      );
      const brand = defaultBrandConfig();
      expect(brand.appName).toBe("Acme Co");
      expect(brand.primaryColor).toBe("#ff0000");
    });

    it("falls back to the template default when no overlay exists", () => {
      writeFileSync(
        join(dir, "src/core/branding/brand.default.json"),
        JSON.stringify({ name: "Default Brand" }),
      );
      const brand = defaultBrandConfig();
      expect(brand.appName).toBe("Default Brand");
    });

    it("falls back to schema built-ins when no JSON exists", () => {
      const brand = defaultBrandConfig();
      expect(brand.appName).toBeTruthy();
      expect(brand.primaryColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(brand.fromEmail).toMatch(/@/);
    });
  });

  describe("brandConfigFromCentral adapter", () => {
    it("maps `name` → `appName`", () => {
      const adapted = brandConfigFromCentral({
        name: "Acme",
        primaryColor: "#ff00aa",
        primaryColorInk: "#000000",
        backgroundColor: "#020203",
        surfaceColor: "#06070a",
        textColor: "#ffffff",
        mutedTextColor: "#888888",
        fromEmail: "no-reply@acme.test",
      });
      expect(adapted.appName).toBe("Acme");
      expect(adapted.primaryColor).toBe("#ff00aa");
      expect(adapted.fromEmail).toBe("no-reply@acme.test");
    });

    it("uses central `legalEntity` when set, falls back to `name`", () => {
      const withLegal = brandConfigFromCentral({
        name: "Acme",
        legalEntity: "Acme Holdings GmbH",
        primaryColor: "#ff00aa",
        primaryColorInk: "#000000",
        backgroundColor: "#020203",
        surfaceColor: "#06070a",
        textColor: "#ffffff",
        mutedTextColor: "#888888",
        fromEmail: "no-reply@acme.test",
      });
      expect(withLegal.legalEntity).toBe("Acme Holdings GmbH");

      const noLegal = brandConfigFromCentral({
        name: "Acme",
        primaryColor: "#ff00aa",
        primaryColorInk: "#000000",
        backgroundColor: "#020203",
        surfaceColor: "#06070a",
        textColor: "#ffffff",
        mutedTextColor: "#888888",
        fromEmail: "no-reply@acme.test",
      });
      expect(noLegal.legalEntity).toBe("Acme");
    });

    it("supplies a default supportEmail when central brand omits it", () => {
      const adapted = brandConfigFromCentral({
        name: "Acme",
        primaryColor: "#ff00aa",
        primaryColorInk: "#000000",
        backgroundColor: "#020203",
        surfaceColor: "#06070a",
        textColor: "#ffffff",
        mutedTextColor: "#888888",
        fromEmail: "no-reply@acme.test",
      });
      // Email layouts surface "Need help? <supportEmail>" only when
      // set — we provide a sentinel that's clearly a placeholder so
      // operators know to fill the real value in /dev/brand.
      expect(adapted.supportEmail).toMatch(/@/);
    });
  });

  describe("resolveBrandConfig with central source", () => {
    it("merges per-call overrides on top of the central default", () => {
      const merged = resolveBrandConfig({ primaryColor: "#abcdef" });
      expect(merged.primaryColor).toBe("#abcdef");
      // Other fields come from the central default
      expect(merged.appName).toBeTruthy();
    });
  });
});
