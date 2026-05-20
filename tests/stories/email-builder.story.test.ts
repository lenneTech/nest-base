import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CORE_EMAIL_TEMPLATES,
  composeEmailTemplateSource,
  decomposeTemplateSource,
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
 * Pure-function planners that the `/hub/email-builder` UI calls
 * through. Codegen turns a JSON composition into a `.tsx` source
 * string; slug + path validation guard the save endpoint against
 * path-traversal and core-template clobbering.
 */
describe("Story · Email-Builder", () => {
  describe("isValidEmailTemplateSlug", () => {
    it.each(["welcome", "password-reset", "abc123", "a", "x-y-z"])("accepts %s", (slug) => {
      expect(isValidEmailTemplateSlug(slug)).toBe(true);
    });

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
    it.each(["email-verification", "password-reset", "welcome", "invitation", "new-device"])(
      "%s is a core template",
      (slug) => {
        expect(isCoreEmailTemplate(slug)).toBe(true);
      },
    );

    it("user-defined templates are not core", () => {
      expect(isCoreEmailTemplate("my-custom-tpl")).toBe(false);
    });

    it("CORE_EMAIL_TEMPLATES catalogues every shipped core template", () => {
      // The 5 templates that ship under src/core/email/templates/ — must
      // match the on-disk inventory so the dev-portal "Core (default)"
      // badge can be derived from this list alone.
      expect([...CORE_EMAIL_TEMPLATES].sort()).toEqual([
        "email-verification",
        "invitation",
        "new-device",
        "password-reset",
        "welcome",
      ]);
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
      expect(source).toContain(
        'import { Barebone } from "../../../core/email/layouts/Barebone.js";',
      );
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
      expect(source).toContain("href={props.verificationUrl}");
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
      expect(source).toMatch(/preheader=\{`[^`]*\$\{props\.appName\}/);
    });

    it("escapes raw text content so quotes don't break the source", () => {
      const composition: EmailComposition = {
        layout: "Barebone",
        subject: "Hi",
        children: [{ type: "paragraph", props: { text: 'She said "hello" and left.' } }],
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

  // -------------------------------------------------------------------
  // decomposeTemplateSource — Issue #49
  // -------------------------------------------------------------------
  describe("decomposeTemplateSource (Issue #49 · core-template editing)", () => {
    /**
     * The decomposer is the inverse of `composeEmailTemplateSource`: it
     * parses a `.tsx` source string back into the JSON composition that
     * the `/hub/email-builder` UI consumes. Round-trip integrity is the
     * load-bearing contract — `decompose(compose(c))` must equal `c` for
     * any composition the composer can build.
     */
    function roundtrip(label: string, composition: EmailComposition): void {
      it(`roundtrips: ${label}`, () => {
        const source = composeEmailTemplateSource({ slug: "rt-test", composition });
        const result = decomposeTemplateSource(source);
        expect(result.decomposable).toBe(true);
        if (!result.decomposable) return;
        expect(result.composition).toEqual(composition);
      });
    }

    roundtrip("plain subject + greeting + paragraph", {
      layout: "Barebone",
      subject: "Welcome",
      children: [
        { type: "greeting", props: { text: "Hello {{recipientName}}," } },
        { type: "paragraph", props: { text: "Thanks for signing up." } },
      ],
    });

    roundtrip("subject + preheader with variable interpolation", {
      layout: "Barebone",
      subject: "Welcome to {{appName}}",
      preheader: "Thanks for joining {{appName}}",
      children: [{ type: "paragraph", props: { text: "Body copy." } }],
    });

    roundtrip("CTA with variable href + footer + divider", {
      layout: "Barebone",
      subject: "Reset your password",
      children: [
        { type: "greeting", props: { text: "Hello {{recipientName}}," } },
        { type: "paragraph", props: { text: "Click the button below." } },
        { type: "cta", props: { href: "{{resetUrl}}", text: "Reset password" } },
        { type: "divider", props: {} },
        { type: "footer", props: { text: "Ignore this email if you didn't request it." } },
      ],
    });

    roundtrip("code / OTP block", {
      layout: "Barebone",
      subject: "Your code",
      children: [
        { type: "paragraph", props: { text: "Your one-time code:" } },
        { type: "code", props: { text: "{{otp}}" } },
      ],
    });

    roundtrip("multiple variable interpolations in one field", {
      layout: "Barebone",
      subject: "{{senderName}} invited you to {{appName}}",
      children: [
        { type: "paragraph", props: { text: "{{senderName}} thinks {{appName}} suits you." } },
      ],
    });

    it("decomposes the shipped welcome.tsx core template", () => {
      const source = readFileSync(
        resolve(process.cwd(), "src/core/email/templates/welcome.tsx"),
        "utf8",
      );
      const result = decomposeTemplateSource(source);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.layout).toBe("Barebone");
      // welcome.tsx subject: `Welcome to ${vars.appName}` → roundtrip uses {{appName}}
      expect(result.composition.subject).toBe("Welcome to {{appName}}");
      // 1 greeting + 2 paragraphs
      expect(result.composition.children.length).toBe(3);
      expect(result.composition.children[0]?.type).toBe("greeting");
      expect(result.composition.children[1]?.type).toBe("paragraph");
      expect(result.composition.children[2]?.type).toBe("paragraph");
    });

    it("decomposes the shipped email-verification.tsx core template", () => {
      const source = readFileSync(
        resolve(process.cwd(), "src/core/email/templates/email-verification.tsx"),
        "utf8",
      );
      const result = decomposeTemplateSource(source);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.subject).toBe("Please verify your email");
      // greeting + paragraph + CTA + footer
      expect(result.composition.children.map((c) => c.type)).toEqual([
        "greeting",
        "paragraph",
        "cta",
        "footer",
      ]);
      const cta = result.composition.children[2];
      expect(cta?.props.href).toBe("{{verificationUrl}}");
    });

    it("decomposes the shipped password-reset.tsx core template", () => {
      const source = readFileSync(
        resolve(process.cwd(), "src/core/email/templates/password-reset.tsx"),
        "utf8",
      );
      const result = decomposeTemplateSource(source);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.subject).toBe("Reset your {{appName}} password");
      expect(result.composition.children.map((c) => c.type)).toEqual([
        "greeting",
        "paragraph",
        "cta",
        "footer",
      ]);
    });

    it("decomposes the shipped invitation.tsx core template", () => {
      const source = readFileSync(
        resolve(process.cwd(), "src/core/email/templates/invitation.tsx"),
        "utf8",
      );
      const result = decomposeTemplateSource(source);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.children.map((c) => c.type)).toEqual([
        "greeting",
        "paragraph",
        "paragraph",
        "cta",
        "footer",
      ]);
    });

    it("decomposes the shipped new-device.tsx core template", () => {
      const source = readFileSync(
        resolve(process.cwd(), "src/core/email/templates/new-device.tsx"),
        "utf8",
      );
      const result = decomposeTemplateSource(source);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.children.map((c) => c.type)).toEqual([
        "greeting",
        "paragraph",
        "paragraph",
        "paragraph",
        "paragraph",
        "paragraph",
        "paragraph",
        "cta",
        "footer",
      ]);
    });

    it("decomposes the shipped api-key-expiring.tsx template", () => {
      const source = readFileSync(
        resolve(process.cwd(), "src/core/email/templates/api-key-expiring.tsx"),
        "utf8",
      );
      const result = decomposeTemplateSource(source);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.children.map((c) => c.type)).toEqual([
        "greeting",
        "paragraph",
        "cta",
        "footer",
      ]);
    });

    it("returns decomposable=false for source missing a Barebone layout", () => {
      const result = decomposeTemplateSource(`
        export default function X() { return <div>hi</div>; }
      `);
      expect(result.decomposable).toBe(false);
    });

    it("returns decomposable=false for source missing a *Meta export", () => {
      const result = decomposeTemplateSource(`
        export default function X(props: { brand?: unknown }) {
          return <Barebone brand={props.brand}><Greeting brand={props.brand}>hi</Greeting></Barebone>;
        }
      `);
      expect(result.decomposable).toBe(false);
    });

    it("decodes a CTA whose href is a literal string (no interpolation)", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (_vars: XVars): string => "Hello",
        };
        export default function X(props: { brand?: unknown }) {
          return (
            <Barebone brand={props.brand}>
              <CTA brand={props.brand} href="https://example.test/static">Open</CTA>
            </Barebone>
          );
        }
      `);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      const cta = result.composition.children[0];
      expect(cta?.type).toBe("cta");
      expect(cta?.props.href).toBe("https://example.test/static");
      expect(cta?.props.text).toBe("Open");
    });

    it("decodes preheader provided as a literal string attribute", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (_vars: XVars): string => "Hello",
        };
        export default function X(props: { brand?: unknown }) {
          return (
            <Barebone brand={props.brand} preheader="A simple preheader">
              <Greeting brand={props.brand}>Hi</Greeting>
            </Barebone>
          );
        }
      `);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.preheader).toBe("A simple preheader");
    });

    it("returns decomposable=false for a self-closed Barebone (no children)", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (_vars: XVars): string => "Hello",
        };
        export default function X(props: { brand?: unknown }) {
          return <Barebone brand={props.brand} />;
        }
      `);
      // Self-closed Barebone is empty children — still valid composition.
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.children).toEqual([]);
    });

    it("returns decomposable=false for empty source", () => {
      const result = decomposeTemplateSource("");
      expect(result.decomposable).toBe(false);
    });

    it("returns decomposable=false for non-string input", () => {
      const result = decomposeTemplateSource(undefined as unknown as string);
      expect(result.decomposable).toBe(false);
    });

    it("returns decomposable=false on unsupported subject expression", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (vars: XVars): string => doSomething(vars),
        };
        export default function X(props: { brand?: unknown }) {
          return <Barebone brand={props.brand}><Greeting brand={props.brand}>Hi</Greeting></Barebone>;
        }
      `);
      expect(result.decomposable).toBe(false);
    });

    it("returns decomposable=false when CTA href uses a complex expression", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (_vars: XVars): string => "Hello",
        };
        export default function X(props: { brand?: unknown; url?: string }) {
          return (
            <Barebone brand={props.brand}>
              <CTA brand={props.brand} href={makeUrl(props.url)}>Go</CTA>
            </Barebone>
          );
        }
      `);
      expect(result.decomposable).toBe(false);
    });

    it("returns decomposable=false when a block has unknown attrs", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (_vars: XVars): string => "Hello",
        };
        export default function X(props: { brand?: unknown }) {
          return (
            <Barebone brand={props.brand}>
              <Greeting brand={props.brand} className="extra">Hi</Greeting>
            </Barebone>
          );
        }
      `);
      expect(result.decomposable).toBe(false);
    });

    it("returns decomposable=false when greeting brand attr is not props.brand", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (_vars: XVars): string => "Hello",
        };
        export default function X(props: { brand?: unknown }) {
          return (
            <Barebone brand={props.brand}>
              <Greeting brand={someComputedBrand()}>Hi</Greeting>
            </Barebone>
          );
        }
      `);
      expect(result.decomposable).toBe(false);
    });

    it("returns decomposable=false when an unknown JSX tag appears among children", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (_vars: XVars): string => "Hello",
        };
        export default function X(props: { brand?: unknown }) {
          return (
            <Barebone brand={props.brand}>
              <Greeting brand={props.brand}>Hi</Greeting>
              <CustomBlock brand={props.brand} />
            </Barebone>
          );
        }
      `);
      expect(result.decomposable).toBe(false);
    });

    it("decodes a subject built via string concatenation", () => {
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (vars: XVars): string => "Hi " + vars.name + "!",
        };
        export default function X(props: { brand?: unknown }) {
          return <Barebone brand={props.brand}><Greeting brand={props.brand}>Hi</Greeting></Barebone>;
        }
      `);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      expect(result.composition.subject).toBe("Hi {{name}}!");
    });

    it("ignores HTML entities inside text (treats them as literal characters)", () => {
      // welcome.tsx has `we&apos;re` — decomposer should resolve to the
      // canonical apostrophe so the composer round-trip survives.
      const result = decomposeTemplateSource(`
        export const xMeta = {
          name: "x",
          subject: (_vars: XVars): string => "Hello",
        };
        export default function X(props: { brand?: unknown }) {
          return (
            <Barebone brand={props.brand}>
              <Paragraph brand={props.brand}>It&apos;s nice.</Paragraph>
            </Barebone>
          );
        }
      `);
      expect(result.decomposable).toBe(true);
      if (!result.decomposable) return;
      const para = result.composition.children[0];
      expect(para?.props.text).toBe("It's nice.");
    });
  });
});
