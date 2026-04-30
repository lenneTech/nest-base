import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  defaultBrandConfig,
  resolveBrandConfig,
  type BrandConfig,
} from "../../src/core/email/brand.js";
import {
  ReactEmailTemplateRenderer,
  ReactEmailTemplateNotFoundError,
  discoverReactEmailTemplates,
} from "../../src/core/email/email-templates.react.js";

/**
 * Story · React-Email Templates.
 *
 * Templates live as `.tsx` on disk. Discovery enumerates the core
 * folder + the project-overlay folder; project files override core
 * files when their basename matches. Locale-suffix resolution
 * (`<name>.<locale>.tsx`) wins over the locale-less default.
 *
 * The renderer dynamically imports the module, calls the React
 * component, hands the tree to `@react-email/render`, and pulls the
 * subject from `<name>Meta.subject(vars)`.
 */
describe("Story · React-Email Templates", () => {
  describe("brand.ts (default brand)", () => {
    it("provides safe default brand values for layouts", () => {
      const brand = defaultBrandConfig();
      expect(brand.appName).toBeTruthy();
      expect(brand.primaryColor).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(brand.primaryColorInk).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(brand.backgroundColor).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(brand.surfaceColor).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(brand.legalEntity).toBeTruthy();
      expect(brand.supportEmail).toMatch(/@/);
      expect(brand.fromEmail).toMatch(/@/);
    });

    it("resolveBrandConfig() merges overrides into the default", () => {
      const merged = resolveBrandConfig({ appName: "Acme", primaryColor: "#ff0000" });
      expect(merged.appName).toBe("Acme");
      expect(merged.primaryColor).toBe("#ff0000");
      // untouched fields keep the default
      expect(merged.legalEntity).toBe(defaultBrandConfig().legalEntity);
    });
  });

  describe("Barebone layout + blocks render to inline-styled HTML", () => {
    it("password-reset built-in template renders the recipient + reset URL + brand-aware CTA color", async () => {
      const renderer = new ReactEmailTemplateRenderer({ brand: defaultBrandConfig() });
      const out = await renderer.render("password-reset", "en", {
        recipientName: "Pascal",
        appName: "Acme",
        resetUrl: "https://app.example.test/reset?token=preview",
      });

      expect(out.subject).toMatch(/reset/i);
      // Subject template uses appName variable
      expect(out.subject).toContain("Acme");
      // Body shows the user content
      expect(out.html).toContain("Pascal");
      expect(out.html).toContain("https://app.example.test/reset?token=preview");
      // Inline style only — no <style> blocks (Gmail/Outlook strip those)
      expect(out.html).not.toMatch(/<style[^>]*>/i);
      // CTA picked up the brand primary color
      expect(out.html.toLowerCase()).toContain(defaultBrandConfig().primaryColor.toLowerCase());
      // Plain-text fallback is non-empty + escapes the URL plainly
      expect(out.text).toContain("https://app.example.test/reset?token=preview");
    });

    it("email-verification template uses the verificationUrl variable", async () => {
      const renderer = new ReactEmailTemplateRenderer({ brand: defaultBrandConfig() });
      const out = await renderer.render("email-verification", "en", {
        recipientName: "Pascal",
        appName: "Acme",
        verificationUrl: "https://app.example.test/verify?token=preview",
      });
      expect(out.subject).toMatch(/verify/i);
      expect(out.html).toContain("https://app.example.test/verify?token=preview");
      expect(out.text).toContain("https://app.example.test/verify?token=preview");
    });

    it("welcome template renders the recipient + appName", async () => {
      const renderer = new ReactEmailTemplateRenderer({ brand: defaultBrandConfig() });
      const out = await renderer.render("welcome", "en", {
        recipientName: "Pascal",
        appName: "Acme",
      });
      expect(out.html).toContain("Pascal");
      expect(out.html).toContain("Acme");
      expect(out.text).toContain("Pascal");
    });

    it("invitation template renders sender + accept URL", async () => {
      const renderer = new ReactEmailTemplateRenderer({ brand: defaultBrandConfig() });
      const out = await renderer.render("invitation", "en", {
        recipientName: "Pascal",
        senderName: "Alice",
        appName: "Acme",
        acceptUrl: "https://app.example.test/invitations/preview/accept",
      });
      expect(out.html).toContain("Alice");
      expect(out.html).toContain("https://app.example.test/invitations/preview/accept");
    });

    it("brand override propagates to the rendered HTML for every template", async () => {
      // Rationale: the central architectural gain over the EJS strings —
      // change brand.primaryColor and every template that imports the
      // shared layout shows the new color in the same render call.
      const brand: BrandConfig = resolveBrandConfig({ primaryColor: "#ff00aa" });
      const renderer = new ReactEmailTemplateRenderer({ brand });
      const out = await renderer.render("password-reset", "en", {
        recipientName: "Pascal",
        appName: "Acme",
        resetUrl: "https://app.example.test/reset?token=preview",
      });
      expect(out.html.toLowerCase()).toContain("#ff00aa");
    });
  });

  describe("ReactEmailTemplateRenderer · discovery + overrides", () => {
    it("throws ReactEmailTemplateNotFoundError when the template does not exist", async () => {
      const renderer = new ReactEmailTemplateRenderer({ brand: defaultBrandConfig() });
      await expect(renderer.render("does-not-exist", "en", {})).rejects.toThrow(
        ReactEmailTemplateNotFoundError,
      );
    });

    it("discoverReactEmailTemplates() lists all four built-in templates", async () => {
      const discovery = await discoverReactEmailTemplates();
      const names = discovery.map((t) => t.name).sort();
      expect(names).toEqual(
        expect.arrayContaining(["email-verification", "invitation", "password-reset", "welcome"]),
      );
    });

    it("project-overlay file overrides the core file with the same basename", async () => {
      const tmpRoot = mkdtempSync(join(tmpdir(), "tpl-override-"));
      try {
        const moduleDir = join(tmpRoot, "src/modules/email/templates");
        mkdirSync(moduleDir, { recursive: true });
        writeFileSync(
          join(moduleDir, "welcome.tsx"),
          [
            "import * as React from 'react';",
            "export const welcomeMeta = {",
            "  name: 'welcome',",
            "  subject: () => 'OVERRIDDEN_SUBJECT',",
            "};",
            "export default function Welcome(props) {",
            "  return React.createElement('div', null, 'OVERRIDDEN_BODY:' + props.recipientName);",
            "}",
          ].join("\n"),
        );

        const discovery = await discoverReactEmailTemplates({ projectRoot: tmpRoot });
        const welcome = discovery.find((t) => t.name === "welcome");
        expect(welcome?.source).toBe("module");
        expect(welcome?.file).toContain(moduleDir);
      } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    describe("locale-suffix lookup", () => {
      const tmpRoot = mkdtempSync(join(tmpdir(), "tpl-locale-"));
      const moduleDir = join(tmpRoot, "src/modules/email/templates");

      beforeAll(() => {
        mkdirSync(moduleDir, { recursive: true });
        writeFileSync(
          join(moduleDir, "newsletter.tsx"),
          [
            "import * as React from 'react';",
            "export const newsletterMeta = { name: 'newsletter', subject: () => 'EN' };",
            "export default function Newsletter() {",
            "  return React.createElement('p', null, 'english');",
            "}",
          ].join("\n"),
        );
        writeFileSync(
          join(moduleDir, "newsletter.de.tsx"),
          [
            "import * as React from 'react';",
            "export const newsletterMeta = { name: 'newsletter', subject: () => 'DE' };",
            "export default function NewsletterDe() {",
            "  return React.createElement('p', null, 'deutsch');",
            "}",
          ].join("\n"),
        );
      });

      afterAll(() => {
        rmSync(tmpRoot, { recursive: true, force: true });
      });

      it("renders the locale variant when present", async () => {
        const renderer = new ReactEmailTemplateRenderer({
          brand: defaultBrandConfig(),
          projectRoot: tmpRoot,
        });
        const out = await renderer.render("newsletter", "de", {});
        expect(out.subject).toBe("DE");
        expect(out.html).toContain("deutsch");
      });

      it("falls back to the locale-less default when no variant exists", async () => {
        const renderer = new ReactEmailTemplateRenderer({
          brand: defaultBrandConfig(),
          projectRoot: tmpRoot,
        });
        const out = await renderer.render("newsletter", "fr", {});
        expect(out.subject).toBe("EN");
        expect(out.html).toContain("english");
      });
    });
  });
});
