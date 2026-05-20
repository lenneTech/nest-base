import { describe, expect, it } from "vitest";

import {
  buildBrandOnlyPreviewPayload,
  extractSendTemplateVarsFromOutboxPayload,
  mergePreviewPayload,
  resolveEmailPreviewPayload,
  stringifyPreviewVars,
} from "../../src/core/dx/email-preview-payload-loader.js";

describe("Story · email preview payload loader", () => {
  it("buildBrandOnlyPreviewPayload returns only appName", () => {
    expect(buildBrandOnlyPreviewPayload("Acme")).toEqual({ appName: "Acme" });
  });

  it("mergePreviewPayload prefers outbox vars over brand keys", () => {
    expect(
      mergePreviewPayload(
        { appName: "Acme" },
        { recipientName: "real@example.com", appName: "Override" },
      ),
    ).toEqual({ appName: "Override", recipientName: "real@example.com" });
  });

  it("extractSendTemplateVarsFromOutboxPayload parses sendTemplate shape", () => {
    const parsed = extractSendTemplateVarsFromOutboxPayload({
      to: "a@b.test",
      template: "welcome",
      vars: { recipientName: "Ada", count: 2 },
    });
    expect(parsed).toEqual({
      template: "welcome",
      vars: { recipientName: "Ada", count: "2" },
    });
  });

  it("resolveEmailPreviewPayload uses outbox when vars exist", () => {
    const map = new Map([["welcome", { recipientName: "Ada" }]]);
    const resolved = resolveEmailPreviewPayload("welcome", "nest-base", map);
    expect(resolved.source).toBe("outbox");
    expect(resolved.payload).toEqual({ appName: "nest-base", recipientName: "Ada" });
  });

  it("resolveEmailPreviewPayload falls back to brand when outbox is empty", () => {
    const map = new Map([["welcome", {}]]);
    const resolved = resolveEmailPreviewPayload("welcome", "nest-base", map);
    expect(resolved.source).toBe("brand");
    expect(resolved.payload).toEqual({ appName: "nest-base" });
  });

  it("stringifyPreviewVars skips nullish values", () => {
    expect(stringifyPreviewVars({ a: "x", b: null, c: undefined, d: 1 })).toEqual({
      a: "x",
      d: "1",
    });
  });
});
