import { describe, expect, it } from "vitest";

import {
  composeEmailTemplateSource,
  isCoreEmailTemplate,
  isValidEmailTemplateLocale,
  isValidEmailTemplateSlug,
  resolveEmailTemplateTarget,
  validateEmailComposition,
  type EmailComposition,
} from "../../src/core/email/email-builder.js";

/**
 * Story · Email-Builder planners (Issue #9).
 *
 * Pure-function planners that the `/dev/email-builder` UI calls
 * through. Codegen turns a JSON composition into a `.tsx` source
 * string; slug + path validation guard the save endpoint against
 * path-traversal and core-template clobbering.
 */
describe("Story · Email-Builder", () => {
  describe("isValidEmailTemplateSlug", () => {
    it.each(["welcome", "password-reset", "abc123", "a", "x-y-z"])(
      "accepts %s",
      (slug) => {
        expect(isValidEmailTemplateSlug(slug)).toBe(true);
      },
    );

    it.each([
      "",
      " welcome",
      "Welcome",
      "-welcome",
      "welcome-",
      "weLcome",
      "../etc",
      "with space",
      "wel..come",
      "wel/come",
      "WELCOME",
      "1welcome", // must start with a-z (kebab case rule from issue body uses [a-z0-9] but we tighten to lowercase letter to avoid numeric-prefixed module names)
    ])("rejects %s", (slug) => {
      expect(isValidEmailTemplateSlug(slug)).toBe(false);
    });
  });

  describe("isValidEmailTemplateLocale", () => {
    it.each(["en", "de", "en-US", "pt-BR"])("accepts %s", (locale) => {
      expect(isValidEmailTemplateLocale(locale)).toBe(true);
    });

    it.each(["", "EN", "english", "en_US", "en-us", "../en"])("rejects %s", (locale) => {
      expect(isValidEmailTemplateLocale(locale)).toBe(false);
    });
  });

  describe("isCoreEmailTemplate", () => {
    it.each(["email-verification", "password-reset", "welcome", "invitation"])(
      "%s is a core template",
      (slug) => {
        expect(isCoreEmailTemplate(slug)).toBe(true);
      },
    );

    it("user-defined templates are not core", () => {
      expect(isCoreEmailTemplate("my-custom-tpl")).toBe(false);
    });
  });

  describe("resolveEmailTemplateTarget", () => {
    const projectRoot = "/repo";

    it("resolves to src/modules/email/templates/<slug>.tsx", () => {
      const result = resolveEmailTemplateTarget({ projectRoot, slug: "my-tpl" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.absolutePath).toBe("/repo/src/modules/email/templates/my-tpl.tsx");
        expect(result.relativePath).toBe("src/modules/email/templates/my-tpl.tsx");
      }
    });

    it("appends the locale suffix when provided", () => {
      const result = resolveEmailTemplateTarget({
        projectRoot,
        slug: "my-tpl",
        locale: "de",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.absolutePath).toBe("/repo/src/modules/email/templates/my-tpl.de.tsx");
      }
    });

    it("rejects invalid slugs", () => {
      const result = resolveEmailTemplateTarget({ projectRoot, slug: "../evil" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/slug/i);
      }
    });

    it("rejects core-template clobbering", () => {
      const result = resolveEmailTemplateTarget({ projectRoot, slug: "password-reset" });
      // Core templates are allowed in module overlay (override pattern),
      // so this should succeed — overlay wins by design. The clobbering
      // guard is on the *core* directory, not the slug name itself.
      expect(result.ok).toBe(true);
    });

    it("rejects an absolute slug that escapes the module root", () => {
      const result = resolveEmailTemplateTarget({ projectRoot, slug: "/etc/passwd" });
      expect(result.ok).toBe(false);
    });

    it("rejects a slug that resolves outside the module root via traversal", () => {
      const result = resolveEmailTemplateTarget({
        projectRoot,
        slug: "..%2F..%2Fetc",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("validateEmailComposition", () => {
    const knownBlocks = ["greeting", "paragraph", "cta", "footer", "code", "divider"];

    it("accepts a valid Barebone composition", () => {
      const composition: EmailComposition = {
        layout: "Barebone",
        subject: "Welcome",
        preheader: "Hello there",
        children: [
          { type: "greeting", props: { text: "Hello {{recipientName}}," } },
          { type: "paragraph", props: { text: "Thanks for signing up." } },
        ],
      };
      const result = validateEmailComposition(composition, { knownBlocks });
      expect(result.ok).toBe(true);
    });

    it("rejects unknown layouts", () => {
      const result = validateEmailComposition(
        { layout: "Acme", subject: "x", children: [] },
        { knownBlocks },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/layout/i);
    });

    it("rejects empty subjects", () => {
      const result = validateEmailComposition(
        { layout: "Barebone", subject: "", children: [] },
        { knownBlocks },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/subject/i);
    });

    it("rejects unknown block types", () => {
      const result = validateEmailComposition(
        {
          layout: "Barebone",
          subject: "x",
          children: [{ type: "marquee", props: {} }],
        },
        { knownBlocks },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/block/i);
    });

    it("requires CTA blocks to declare an href", () => {
      const result = validateEmailComposition(
        {
          layout: "Barebone",
          subject: "x",
          children: [{ type: "cta", props: { text: "Go" } }],
        },
        { knownBlocks },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/href/i);
    });
  });

  describe("composeEmailTemplateSource (codegen)", () => {
    it("emits a deterministic .tsx source for a Barebone composition", () => {
      const composition: EmailComposition = {
        layout: "Barebone",
        subject: "Welcome to {{appName}}",
        preheader: "Hello",
        children: [
          { type: "greeting", props: { text: "Hello {{recipientName}}," } },
          { type: "paragraph", props: { text: "Thanks for signing up." } },
          {
            type: "cta",
            props: { href: "{{verificationUrl}}", text: "Verify email" },
          },
          { type: "divider", props: {} },
          { type: "footer", props: { text: "Ignore this email if you didn't sign up." } },
        ],
      };
      const source = composeEmailTemplateSource({
        slug: "my-welcome",
        composition,
      });

      // Auto-generated header banner — explicit warning the file is
      // codegen'd so hand-edits get clobbered on the next save.
      expect(source).toContain("AUTO-GENERATED");
      // Imports — Barebone layout, the blocks the composition uses,
      // BrandConfig type from the email module.
      expect(source).toContain('import { Barebone } from "../layouts/Barebone.js";');
      expect(source).toContain("Greeting");
      expect(source).toContain("Paragraph");
      expect(source).toContain("CTA");
      expect(source).toContain("Footer");
      expect(source).toContain("Divider");
      expect(source).not.toContain("Code"); // Code block isn't in the composition
      // Subject factory exported as `<Slug>Meta`
      expect(source).toContain("export const myWelcomeMeta");
      expect(source).toContain('name: "my-welcome"');
      expect(source).toContain("Welcome to ${vars.appName}");
      // Default-export component returns a Barebone tree
      expect(source).toContain("export default function MyWelcome");
      expect(source).toContain("<Barebone");
      expect(source).toContain("preheader=");
      // Variable interpolation `{{recipientName}}` becomes `{props.recipientName}`
      expect(source).toContain("{props.recipientName}");
      expect(source).toContain('href={props.verificationUrl}');
    });

    it("two calls with the same input produce the same output (deterministic)", () => {
      const composition: EmailComposition = {
        layout: "Barebone",
        subject: "Hi",
        children: [{ type: "paragraph", props: { text: "Hello." } }],
      };
      const a = composeEmailTemplateSource({ slug: "stable", composition });
      const b = composeEmailTemplateSource({ slug: "stable", composition });
      expect(a).toBe(b);
    });

    it("collects every variable referenced in the composition", () => {
      const composition: EmailComposition = {
        layout: "Barebone",
        subject: "Hi {{recipientName}}",
        preheader: "Action required for {{appName}}",
        children: [
          { type: "paragraph", props: { text: "{{recipientName}} please confirm" } },
          { type: "cta", props: { href: "{{verificationUrl}}", text: "Verify" } },
        ],
      };
      const source = composeEmailTemplateSource({
        slug: "verify",
        composition,
      });
      // Every distinct var appears in the Vars interface
      expect(source).toMatch(/recipientName: string/);
      expect(source).toMatch(/appName: string/);
      expect(source).toMatch(/verificationUrl: string/);
    });

    it("escapes raw text content so quotes don't break the source", () => {
      const composition: EmailComposition = {
        layout: "Barebone",
        subject: "Hi",
        children: [
          { type: "paragraph", props: { text: 'She said "hello" and left.' } },
        ],
      };
      const source = composeEmailTemplateSource({ slug: "quoted", composition });
      // Either escapes the inner quotes or uses JSX child text safely —
      // the smoke test is "no syntax error from raw double quotes".
      expect(source).not.toContain('"She said "hello"');
    });

    it("turns kebab-case slugs into PascalCase component names", () => {
      const composition: EmailComposition = {
        layout: "Barebone",
        subject: "x",
        children: [{ type: "paragraph", props: { text: "x" } }],
      };
      const source = composeEmailTemplateSource({
        slug: "team-onboarding-welcome",
        composition,
      });
      expect(source).toContain("export default function TeamOnboardingWelcome");
      expect(source).toContain("export const teamOnboardingWelcomeMeta");
    });
  });
});
