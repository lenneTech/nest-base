import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render as renderEmail } from "@react-email/render";
import * as React from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Code, Divider, Footer, Greeting, Paragraph } from "../../src/core/email/blocks/index.js";
import { Barebone } from "../../src/core/email/layouts/Barebone.js";
import {
  defaultBrandConfig,
  resolveBrandConfig,
  type BrandConfig,
} from "../../src/core/email/brand.js";
import {
  ReactEmailTemplateRenderer,
  ReactEmailTemplateInvalidError,
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

    it("magic-link template renders the recipient + sign-in URL + appName in the subject", async () => {
      const renderer = new ReactEmailTemplateRenderer({ brand: defaultBrandConfig() });
      const out = await renderer.render("magic-link", "en", {
        recipientName: "Pascal",
        appName: "Acme",
        magicLinkUrl: "https://app.example.test/auth/magic?token=preview",
      });
      // Subject pulls the appName so it reads natural per-brand.
      expect(out.subject).toContain("Acme");
      expect(out.subject).toMatch(/sign-in/i);
      expect(out.html).toContain("Pascal");
      expect(out.html).toContain("https://app.example.test/auth/magic?token=preview");
      expect(out.text).toContain("https://app.example.test/auth/magic?token=preview");
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

    it("ReactEmailTemplateNotFoundError carries the template name + locale", () => {
      const err = new ReactEmailTemplateNotFoundError("welcome", "de");
      expect(err.name).toBe("ReactEmailTemplateNotFoundError");
      expect(err.message).toContain("welcome");
      expect(err.message).toContain("de");
    });

    it("ReactEmailTemplateInvalidError carries the file path", () => {
      const err = new ReactEmailTemplateInvalidError("/abs/path/welcome.tsx", "missing meta");
      expect(err.name).toBe("ReactEmailTemplateInvalidError");
      expect(err.message).toContain("welcome.tsx");
      expect(err.message).toContain("missing meta");
    });

    it("throws ReactEmailTemplateInvalidError when the template lacks a default export", async () => {
      const tmpRoot = mkdtempSync(join(tmpdir(), "tpl-invalid-default-"));
      try {
        const moduleDir = join(tmpRoot, "src/modules/email/templates");
        mkdirSync(moduleDir, { recursive: true });
        writeFileSync(
          join(moduleDir, "broken.tsx"),
          [
            // Intentional: no default export → renderer must complain.
            "export const brokenMeta = { name: 'broken', subject: () => 'broken' };",
          ].join("\n"),
        );
        const renderer = new ReactEmailTemplateRenderer({
          brand: defaultBrandConfig(),
          projectRoot: tmpRoot,
        });
        await expect(renderer.render("broken", "en", {})).rejects.toThrow(
          ReactEmailTemplateInvalidError,
        );
      } finally {
        rmSync(tmpRoot, { recursive: true, force: true });
      }
    });

    it("throws ReactEmailTemplateInvalidError when the template lacks a Meta export", async () => {
      const tmpRoot = mkdtempSync(join(tmpdir(), "tpl-invalid-meta-"));
      try {
        const moduleDir = join(tmpRoot, "src/modules/email/templates");
        mkdirSync(moduleDir, { recursive: true });
        writeFileSync(
          join(moduleDir, "no-meta.tsx"),
          [
            "import * as React from 'react';",
            // Intentional: no `<name>Meta` export → subject lookup fails.
            "export default function NoMeta() {",
            "  return React.createElement('p', null, 'x');",
            "}",
          ].join("\n"),
        );
        const renderer = new ReactEmailTemplateRenderer({
          brand: defaultBrandConfig(),
          projectRoot: tmpRoot,
        });
        await expect(renderer.render("no-meta", "en", {})).rejects.toThrow(
          ReactEmailTemplateInvalidError,
        );
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

  describe("Block library renders independently", () => {
    // Each block is exercised through the live renderer so that the
    // inline-styled HTML output is verifiable, not just the React tree
    // shape. Code + Divider have no built-in template that uses them
    // yet — these tests pin their rendered surface so the block stays
    // covered when consumers eventually adopt them.

    async function renderShell(child: React.ReactNode): Promise<string> {
      return renderEmail(React.createElement(Barebone, { children: child }));
    }

    it("Greeting renders the children inside a heading-weight element", async () => {
      const html = await renderShell(React.createElement(Greeting, null, "Hello there"));
      expect(html).toContain("Hello there");
      expect(html).toContain("font-weight:600");
    });

    it("Paragraph renders body copy with the brand text color", async () => {
      const brand: BrandConfig = resolveBrandConfig({ textColor: "#abc123" });
      const html = await renderShell(React.createElement(Paragraph, { brand }, "paragraph copy"));
      expect(html).toContain("paragraph copy");
      expect(html.toLowerCase()).toContain("#abc123");
    });

    it("Footer renders muted small print", async () => {
      const brand: BrandConfig = resolveBrandConfig({ mutedTextColor: "#998877" });
      const html = await renderShell(React.createElement(Footer, { brand }, "footer text"));
      expect(html).toContain("footer text");
      expect(html.toLowerCase()).toContain("#998877");
    });

    it("Code renders monospace-styled token block colored with the brand primary", async () => {
      const brand: BrandConfig = resolveBrandConfig({ primaryColor: "#33ddee" });
      const html = await renderShell(React.createElement(Code, { brand }, "TOKEN-ABC-123"));
      expect(html).toContain("TOKEN-ABC-123");
      expect(html.toLowerCase()).toContain("#33ddee");
      expect(html.toLowerCase()).toMatch(/font-family:[^;]*menlo|consolas|sfmono/i);
    });

    it("Divider renders a horizontal rule with the configured spacing", async () => {
      const html = await renderShell(React.createElement(Divider, { spacing: 42 }));
      expect(html.toLowerCase()).toContain("<hr");
      expect(html).toContain("42px");
    });

    it("Divider falls back to the default spacing when no override is given", async () => {
      const html = await renderShell(React.createElement(Divider));
      expect(html.toLowerCase()).toContain("<hr");
    });

    it("Barebone renders the preheader when supplied", async () => {
      const html = await renderEmail(
        React.createElement(
          Barebone,
          { preheader: "preheader-text-marker" },
          React.createElement(Paragraph, null, "body"),
        ),
      );
      expect(html).toContain("preheader-text-marker");
    });

    it("Barebone hides the support row when supportEmail is empty", async () => {
      const brand: BrandConfig = resolveBrandConfig({ supportEmail: "" });
      const html = await renderEmail(
        React.createElement(Barebone, { brand }, React.createElement(Paragraph, null, "body")),
      );
      expect(html).not.toContain("Need help?");
    });
  });
});
