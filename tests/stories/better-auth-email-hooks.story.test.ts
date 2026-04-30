import { describe, expect, it } from "vitest";

import {
  buildEmailHookPayload,
  resolveAppName,
  resolveRecipientName,
  type BetterAuthEmailUser,
} from "../../src/core/auth/better-auth-email-hooks.js";

/**
 * Story · Better-Auth → EmailService hook payloads.
 *
 * The hook layer is split into a pure planner ("given a hook payload,
 * build the matching `sendTemplate` argument") and a thin runner that
 * lives inside the Better-Auth options object and calls `EmailService`.
 *
 * This story pins the planner: every Better-Auth flow produces the
 * canonical `{ template, to, vars }` shape. The runner half is exercised
 * via the e2e specs that boot the full app + Mailpit.
 */
describe("Story · Better-Auth email hooks (planner)", () => {
  const appName = "Acme";

  describe("resolveRecipientName()", () => {
    it("prefers `name` when present", () => {
      const user: BetterAuthEmailUser = { id: "u1", email: "a@b.io", name: "Alice Cooper" };
      expect(resolveRecipientName(user)).toBe("Alice Cooper");
    });

    it("falls back to displayName when name is missing", () => {
      const user: BetterAuthEmailUser = {
        id: "u1",
        email: "a@b.io",
        name: "",
        displayName: "Ali",
      };
      expect(resolveRecipientName(user)).toBe("Ali");
    });

    it("derives from the email local-part as the last resort", () => {
      const user: BetterAuthEmailUser = { id: "u1", email: "alice.cooper@b.io", name: "" };
      expect(resolveRecipientName(user)).toBe("alice.cooper");
    });

    it('returns "there" when even the email is unparseable', () => {
      // synthetic edge-case — Better-Auth always supplies an email, but the
      // helper stays defensive so a malformed plugin payload never crashes
      // the auth flow.
      const user: BetterAuthEmailUser = { id: "u1", email: "", name: "" };
      expect(resolveRecipientName(user)).toBe("there");
    });
  });

  describe("resolveAppName()", () => {
    it("reads APP_NAME from env when set", () => {
      expect(resolveAppName({ APP_NAME: "Acme" })).toBe("Acme");
    });

    it("falls back to the brand default when APP_NAME is missing", () => {
      // no APP_NAME → use the configured `BrandConfig.appName`. The
      // brand-config is the second source of truth (issue #5).
      expect(resolveAppName({})).toBeTypeOf("string");
      expect(resolveAppName({}).length).toBeGreaterThan(0);
    });

    it("ignores empty-string APP_NAME (CI surfaces unset vars as empty)", () => {
      expect(resolveAppName({ APP_NAME: "" })).not.toBe("");
    });
  });

  describe("buildEmailHookPayload()", () => {
    const user: BetterAuthEmailUser = { id: "u1", email: "a@b.io", name: "Alice" };

    it("maps the email-verification hook to the email-verification template", () => {
      const out = buildEmailHookPayload({
        kind: "email-verification",
        user,
        url: "https://app.example.com/verify?token=xyz",
        appName,
      });
      expect(out).toEqual({
        template: "email-verification",
        to: "a@b.io",
        vars: {
          recipientName: "Alice",
          appName: "Acme",
          verificationUrl: "https://app.example.com/verify?token=xyz",
        },
      });
    });

    it("maps the password-reset hook to the password-reset template", () => {
      const out = buildEmailHookPayload({
        kind: "password-reset",
        user,
        url: "https://app.example.com/reset?token=xyz",
        appName,
      });
      expect(out).toEqual({
        template: "password-reset",
        to: "a@b.io",
        vars: {
          recipientName: "Alice",
          appName: "Acme",
          resetUrl: "https://app.example.com/reset?token=xyz",
        },
      });
    });

    it("maps the post-verification welcome hook to the welcome template", () => {
      const out = buildEmailHookPayload({ kind: "welcome", user, appName });
      expect(out).toEqual({
        template: "welcome",
        to: "a@b.io",
        vars: { recipientName: "Alice", appName: "Acme" },
      });
    });

    it("maps the invitation hook to the invitation template", () => {
      const out = buildEmailHookPayload({
        kind: "invitation",
        user,
        url: "https://app.example.com/accept?token=xyz",
        appName,
        senderName: "Bob",
      });
      expect(out).toEqual({
        template: "invitation",
        to: "a@b.io",
        vars: {
          recipientName: "Alice",
          appName: "Acme",
          acceptUrl: "https://app.example.com/accept?token=xyz",
          senderName: "Bob",
        },
      });
    });

    it("uses the email local-part when the user has no name (falls back gracefully)", () => {
      const u: BetterAuthEmailUser = { id: "u1", email: "anon@b.io", name: "" };
      const out = buildEmailHookPayload({
        kind: "email-verification",
        user: u,
        url: "https://x/y",
        appName,
      });
      expect(out.vars).toMatchObject({ recipientName: "anon" });
    });

    it("rejects an empty url for hooks that require one (verification)", () => {
      // Empty URL would render an invalid `<a href="">` button — better
      // to fail fast at the planner than ship a broken email.
      expect(() =>
        buildEmailHookPayload({ kind: "email-verification", user, url: "", appName }),
      ).toThrow(/url/i);
    });

    it("rejects an empty url for the password-reset hook", () => {
      expect(() =>
        buildEmailHookPayload({ kind: "password-reset", user, url: "", appName }),
      ).toThrow(/url/i);
    });

    it("rejects an empty url for the invitation hook", () => {
      expect(() =>
        buildEmailHookPayload({
          kind: "invitation",
          user,
          url: "",
          appName,
          senderName: "Bob",
        }),
      ).toThrow(/url/i);
    });

    it("rejects an empty appName (operator misconfiguration)", () => {
      expect(() =>
        buildEmailHookPayload({
          kind: "email-verification",
          user,
          url: "https://x/y",
          appName: "",
        }),
      ).toThrow(/appName/i);
    });

    it("rejects an empty recipient email (Better-Auth would never do this, but the planner stays safe)", () => {
      const u: BetterAuthEmailUser = { id: "u1", email: "", name: "Alice" };
      expect(() =>
        buildEmailHookPayload({
          kind: "email-verification",
          user: u,
          url: "https://x/y",
          appName,
        }),
      ).toThrow(/email/i);
    });

    it("falls back to a friendly default senderName when invitation hook omits it", () => {
      const out = buildEmailHookPayload({
        kind: "invitation",
        user,
        url: "https://x/y",
        appName,
        senderName: "",
      });
      // "A teammate" reads better than an empty `<strong></strong>` block.
      expect(out.vars).toMatchObject({ senderName: "A teammate" });
    });
  });
});
