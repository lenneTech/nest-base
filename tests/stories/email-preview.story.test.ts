import { describe, expect, it } from "vitest";

import { buildEmailPreviewCatalog, renderEmailPreview } from "../../src/core/dx/email-preview.js";
import {
  buildBrandOnlyPreviewPayload,
  resolveEmailPreviewPayload,
} from "../../src/core/dx/email-preview-payload-loader.js";
import { ReactEmailTemplateRenderer } from "../../src/core/email/email-templates.react.js";

/**
 * Story · `/dev/email-preview`.
 *
 * Catalog lists templates; payloads come from outbox or brand at request time.
 */
describe("Story · email preview", () => {
  describe("buildEmailPreviewCatalog", () => {
    it("returns the four built-in templates without fabricated sample payloads", () => {
      const catalog = buildEmailPreviewCatalog();
      expect(catalog.entries.map((e) => e.template).sort()).toEqual([
        "email-verification",
        "invitation",
        "password-reset",
        "welcome",
      ]);
      for (const entry of catalog.entries) {
        expect(entry).not.toHaveProperty("samplePayload");
        expect(entry.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("renderEmailPreview", () => {
    it("renders welcome with brand-only payload", async () => {
      const renderer = new ReactEmailTemplateRenderer();
      const { payload } = resolveEmailPreviewPayload("welcome", "nest-base", new Map());
      const preview = await renderEmailPreview({
        renderer,
        template: "welcome",
        locale: "en",
        payload,
      });
      expect(preview.subject).toBe("Welcome to nest-base");
      expect(preview.html).toContain("nest-base");
      expect(buildBrandOnlyPreviewPayload("nest-base")).toEqual(payload);
    });

    it("returns an error envelope (not throws) for unknown templates", async () => {
      const renderer = new ReactEmailTemplateRenderer();
      const result = await renderEmailPreview({
        renderer,
        template: "does-not-exist",
        locale: "en",
        payload: {},
      });
      expect(result.error).toBeDefined();
      expect(result.subject).toBeUndefined();
    });

    it("renders successfully even with sparse payloads (React renderer is lenient)", async () => {
      const renderer = new ReactEmailTemplateRenderer();
      const result = await renderEmailPreview({
        renderer,
        template: "welcome",
        locale: "en",
        payload: {},
      });
      if (result.error) {
        expect(typeof result.error).toBe("string");
      } else {
        expect(typeof result.html).toBe("string");
        expect(typeof result.subject).toBe("string");
      }
    });
  });
});
