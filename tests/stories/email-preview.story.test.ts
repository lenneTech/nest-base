import { describe, expect, it } from "vitest";

import { buildEmailPreviewCatalog, renderEmailPreview } from "../../src/core/dx/email-preview.js";
import {
  EjsEmailTemplateRenderer,
  buildBuiltInEmailTemplateRegistry,
} from "../../src/core/email/email-templates.js";

/**
 * Story · `/dev/email-preview`.
 *
 * The catalog enumerates every registered template + a sample
 * payload. The renderer composes a single template + payload into
 * the rendered subject / HTML / text. Both are pure functions; the
 * runner injects the registry from EmailModule.
 */
describe("Story · email preview", () => {
  describe("buildEmailPreviewCatalog", () => {
    it("returns the four built-in templates with sample payloads", () => {
      const catalog = buildEmailPreviewCatalog();
      expect(catalog.entries.map((e) => e.template).sort()).toEqual([
        "email-verification",
        "invitation",
        "password-reset",
        "welcome",
      ]);
    });

    it("every entry has a non-empty sample-payload object with realistic strings", () => {
      const catalog = buildEmailPreviewCatalog();
      for (const entry of catalog.entries) {
        expect(typeof entry.samplePayload).toBe("object");
        expect(Object.keys(entry.samplePayload).length).toBeGreaterThan(0);
        // No undefined / empty values — preview should look plausible.
        for (const value of Object.values(entry.samplePayload)) {
          expect(typeof value).toBe("string");
          expect(value).not.toBe("");
        }
      }
    });

    it("provides URLs for templates that contain URL variables", () => {
      const catalog = buildEmailPreviewCatalog();
      const verification = catalog.entries.find((e) => e.template === "email-verification");
      expect(verification?.samplePayload.verificationUrl).toMatch(/^https?:\/\//);
      const invite = catalog.entries.find((e) => e.template === "invitation");
      expect(invite?.samplePayload.acceptUrl).toMatch(/^https?:\/\//);
    });
  });

  describe("renderEmailPreview", () => {
    it("renders a template with the sample payload from the catalog", async () => {
      const renderer = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
      const preview = await renderEmailPreview({
        renderer,
        template: "welcome",
        locale: "en",
        payload: { recipientName: "Alice", appName: "nest-base" },
      });
      expect(preview.subject).toBe("Welcome to nest-base");
      expect(preview.html).toContain("Hello Alice");
      expect(preview.html).toContain("Welcome to nest-base");
      expect(preview.text).toContain("Hello Alice");
    });

    it("returns an error envelope (not throws) for unknown templates", async () => {
      const renderer = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
      const result = await renderEmailPreview({
        renderer,
        template: "does-not-exist",
        locale: "en",
        payload: {},
      });
      expect(result.error).toBeDefined();
      expect(result.subject).toBeUndefined();
    });

    it("returns an error envelope when a required variable is missing", async () => {
      const renderer = new EjsEmailTemplateRenderer(buildBuiltInEmailTemplateRegistry());
      const result = await renderEmailPreview({
        renderer,
        template: "welcome",
        locale: "en",
        payload: {}, // missing recipientName / appName
      });
      expect(result.error).toBeDefined();
      expect(result.error).toMatch(/missing variable|recipientName|appName/i);
    });
  });
});
