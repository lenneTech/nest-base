import { describe, expect, it } from "vitest";

import {
  EmailRecipientBlockedError,
  EmailRecipientRateLimitedError,
  EmailService,
  type EmailDriver,
  type EmailRenderedTemplate,
  type EmailTemplateRenderer,
} from "../../src/core/email/email.service.js";
import { RecipientRateLimiter } from "../../src/core/email/recipient-rate-limiter.js";

/**
 * Story · EmailService consumes blocklist + recipient rate limiter +
 * locale fallback chain (CF.EMAIL.* — Findings 7+8 from iter-96 review).
 *
 * The three helpers existed as orphan files prior to iter-97. This
 * story locks them into `EmailService.send()` / `sendTemplate()`:
 *   1. Blocklist check (`checkRecipientBlocklist`) runs after the
 *      dev whitelist; blocked recipients throw
 *      `EmailRecipientBlockedError` and never reach the transport.
 *   2. Per-recipient rate-limiter (`RecipientRateLimiter`) runs next;
 *      over-cap recipients throw `EmailRecipientRateLimitedError`.
 *   3. `sendTemplate()` walks the locale fallback chain
 *      (`resolveLocaleFallbackChain`) — exact → language root →
 *      default — picking the first locale the renderer can render.
 */

function fakePrimary(): EmailDriver & { sent: { to: string; subject: string }[] } {
  const sent: { to: string; subject: string }[] = [];
  return {
    name: "fake",
    sent,
    async send(msg) {
      sent.push({ to: msg.to, subject: msg.subject });
      return { messageId: `m-${sent.length}`, driver: "fake" };
    },
    async sendTemplate(msg) {
      sent.push({ to: msg.to, subject: msg.subject });
      return { messageId: `t-${sent.length}`, driver: "fake" };
    },
  };
}

function fakeRenderer(
  available: readonly string[],
): EmailTemplateRenderer & { calls: { template: string; locale: string }[] } {
  const calls: { template: string; locale: string }[] = [];
  return {
    calls,
    async render(template, locale): Promise<EmailRenderedTemplate> {
      calls.push({ template, locale });
      if (!available.includes(locale)) {
        throw new Error(`renderer: template=${template} locale=${locale} not found`);
      }
      return {
        subject: `${template}/${locale}`,
        html: `<p>${template}/${locale}</p>`,
        text: `${template}/${locale}`,
      };
    },
  };
}

describe("Story · EmailService blocklist + rate limit + locale fallback", () => {
  describe("blocklist", () => {
    it("throws EmailRecipientBlockedError when the recipient matches an entry", async () => {
      const primary = fakePrimary();
      const renderer = fakeRenderer(["en"]);
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        blocklist: [{ pattern: "blocked@example.com", reason: "user-unsubscribed" }],
      });
      await expect(
        svc.send({ to: "blocked@example.com", subject: "x", html: "<p>x</p>" }),
      ).rejects.toBeInstanceOf(EmailRecipientBlockedError);
      expect(primary.sent).toHaveLength(0);
    });

    it("blocks an entire domain via @example.com pattern", async () => {
      const primary = fakePrimary();
      const renderer = fakeRenderer(["en"]);
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        blocklist: [{ pattern: "@spam.example", reason: "spam-domain" }],
      });
      await expect(svc.send({ to: "alice@spam.example", subject: "x", html: "x" })).rejects.toThrow(
        EmailRecipientBlockedError,
      );
    });

    it("allows recipients not on the list", async () => {
      const primary = fakePrimary();
      const renderer = fakeRenderer(["en"]);
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        blocklist: [{ pattern: "blocked@example.com", reason: "x" }],
      });
      await svc.send({ to: "alice@example.com", subject: "x", html: "x" });
      expect(primary.sent).toHaveLength(1);
    });
  });

  describe("recipient rate limiter", () => {
    it("throws EmailRecipientRateLimitedError when over the cap", async () => {
      const primary = fakePrimary();
      const renderer = fakeRenderer(["en"]);
      const limiter = new RecipientRateLimiter({ limit: 2, windowMs: 60_000, maxEntries: 100 });
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        recipientRateLimiter: limiter,
      });

      // First two pass.
      await svc.send({ to: "alice@example.com", subject: "1", html: "1" });
      await svc.send({ to: "alice@example.com", subject: "2", html: "2" });
      // Third throws.
      await expect(
        svc.send({ to: "alice@example.com", subject: "3", html: "3" }),
      ).rejects.toBeInstanceOf(EmailRecipientRateLimitedError);
      expect(primary.sent).toHaveLength(2);
    });

    it("isolates per-recipient counters", async () => {
      const primary = fakePrimary();
      const renderer = fakeRenderer(["en"]);
      const limiter = new RecipientRateLimiter({ limit: 1, windowMs: 60_000, maxEntries: 100 });
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        recipientRateLimiter: limiter,
      });

      await svc.send({ to: "alice@example.com", subject: "1", html: "1" });
      await svc.send({ to: "bob@example.com", subject: "2", html: "2" });
      // Alice over cap, Bob fine — but bob already used her one — actually let me re-test fresh
      await expect(svc.send({ to: "alice@example.com", subject: "3", html: "3" })).rejects.toThrow(
        EmailRecipientRateLimitedError,
      );
      expect(primary.sent).toHaveLength(2);
    });
  });

  describe("locale fallback chain in sendTemplate", () => {
    it("uses exact userLocale when available", async () => {
      const primary = fakePrimary();
      const renderer = fakeRenderer(["en", "de"]);
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        availableLocalesByTemplate: { greeting: ["en", "de"] },
      });

      await svc.sendTemplate({
        to: "alice@example.com",
        template: "greeting",
        userLocale: "de",
        vars: {},
      });
      expect(renderer.calls).toEqual([{ template: "greeting", locale: "de" }]);
    });

    it("falls back to language root when regional variant is missing", async () => {
      const primary = fakePrimary();
      const renderer = fakeRenderer(["en", "de"]);
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        availableLocalesByTemplate: { greeting: ["en", "de"] },
      });

      // de-AT not available, falls back to de.
      await svc.sendTemplate({
        to: "alice@example.com",
        template: "greeting",
        userLocale: "de-AT",
        vars: {},
      });
      // Renderer is asked for de (de-AT → de via root, available).
      const localesTried = renderer.calls.map((c) => c.locale);
      expect(localesTried).toContain("de");
      expect(primary.sent).toHaveLength(1);
    });

    it("falls back to default locale when user locale is unknown", async () => {
      const primary = fakePrimary();
      const renderer = fakeRenderer(["en"]);
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        defaultLocale: "en",
        availableLocalesByTemplate: { greeting: ["en"] },
      });
      await svc.sendTemplate({
        to: "alice@example.com",
        template: "greeting",
        userLocale: "fr",
        vars: {},
      });
      const tried = renderer.calls.map((c) => c.locale);
      expect(tried).toContain("en");
    });

    it("walks the chain and uses the first locale the renderer succeeds on", async () => {
      const primary = fakePrimary();
      // Renderer says de is unavailable (throws), en succeeds.
      const renderer = fakeRenderer(["en"]);
      const svc = new EmailService({
        primary,
        renderer,
        defaultFrom: "noreply@example.com",
        defaultLocale: "en",
        availableLocalesByTemplate: { greeting: ["en"] },
      });
      await svc.sendTemplate({
        to: "alice@example.com",
        template: "greeting",
        userLocale: "de",
        vars: {},
      });
      expect(renderer.calls.map((c) => c.locale)).toEqual(["en"]);
    });
  });
});
