import { describe, expect, it } from "vitest";

import {
  BrandConfigSchema,
  type BrandConfig,
  decodeBrand,
} from "../../src/core/branding/brand-schema.js";

/**
 * Story · Brand-Config schema.
 *
 * `BrandConfigSchema` is the single Zod definition every consumer
 * (loader, dev-portal, email layouts, OpenAPI) parses against. It
 * guards the boundary between "JSON on disk" / "edits via /hub/brand"
 * and "validated, fully-typed BrandConfig" the rest of the code uses.
 *
 * The schema is intentionally strict on hex-colors and email shape
 * because those values flow into CSS / email-headers without further
 * sanitisation. Bad input here means broken visuals or undeliverable
 * mail; we want a clear validation error at the source instead.
 */
describe("Story · BrandConfigSchema", () => {
  describe("required fields", () => {
    it("accepts a minimal valid brand", () => {
      const input = { name: "Acme" };
      const parsed: BrandConfig = BrandConfigSchema.parse(input);
      expect(parsed.name).toBe("Acme");
      // defaults filled by Zod
      expect(parsed.primaryColor).toBe("#c5fb45");
      expect(parsed.primaryColorInk).toBe("#0a0a0a");
      expect(parsed.backgroundColor).toBe("#020203");
      expect(parsed.surfaceColor).toBe("#06070a");
      expect(parsed.fromEmail).toBe("no-reply@example.com");
    });

    it("rejects an empty `name`", () => {
      expect(() => BrandConfigSchema.parse({ name: "" })).toThrow();
    });

    it("rejects when `name` is missing", () => {
      expect(() => BrandConfigSchema.parse({})).toThrow();
    });
  });

  describe("hex-color validation", () => {
    it("accepts 6-digit lowercase hex", () => {
      const parsed = BrandConfigSchema.parse({ name: "x", primaryColor: "#ff00aa" });
      expect(parsed.primaryColor).toBe("#ff00aa");
    });

    it("accepts 6-digit uppercase hex", () => {
      const parsed = BrandConfigSchema.parse({ name: "x", primaryColor: "#FF00AA" });
      expect(parsed.primaryColor).toBe("#FF00AA");
    });

    it("rejects 3-digit hex shortcut", () => {
      // Strict 6-digit rule keeps the CSS-generator pass-through deterministic.
      expect(() => BrandConfigSchema.parse({ name: "x", primaryColor: "#fff" })).toThrow();
    });

    it("rejects values without a leading `#`", () => {
      expect(() => BrandConfigSchema.parse({ name: "x", primaryColor: "ff00aa" })).toThrow();
    });

    it("rejects malicious CSS injection in hex fields", () => {
      expect(() =>
        BrandConfigSchema.parse({
          name: "x",
          primaryColor: "#abc) ; background: url(javascript:alert(1)",
        }),
      ).toThrow();
    });
  });

  describe("email validation", () => {
    it("rejects an invalid `fromEmail`", () => {
      expect(() => BrandConfigSchema.parse({ name: "x", fromEmail: "not-an-email" })).toThrow();
    });

    it("rejects an invalid `supportEmail` when supplied", () => {
      expect(() => BrandConfigSchema.parse({ name: "x", supportEmail: "not-an-email" })).toThrow();
    });
  });

  describe("URL validation", () => {
    it("rejects an invalid `logoUrl`", () => {
      expect(() => BrandConfigSchema.parse({ name: "x", logoUrl: "not a url" })).toThrow();
    });

    it("rejects an invalid `supportUrl`", () => {
      expect(() => BrandConfigSchema.parse({ name: "x", supportUrl: "not a url" })).toThrow();
    });

    it("accepts a `data:` URL for `logoUrl`", () => {
      const dataUri = "data:image/svg+xml;base64,PHN2Zy8+";
      const parsed = BrandConfigSchema.parse({ name: "x", logoUrl: dataUri });
      expect(parsed.logoUrl).toBe(dataUri);
    });
  });

  describe("decodeBrand (pure planner)", () => {
    it("returns a typed BrandConfig from valid input", () => {
      const result = decodeBrand({ name: "Acme", primaryColor: "#aabbcc" });
      expect(result.name).toBe("Acme");
      expect(result.primaryColor).toBe("#aabbcc");
    });

    it("throws a ZodError on invalid input", () => {
      // Pure decoder — wraps Schema.parse without I/O. Used by the loader.
      expect(() => decodeBrand({ name: "" })).toThrow();
    });
  });
});
