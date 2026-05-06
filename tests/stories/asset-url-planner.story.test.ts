/**
 * Story · Dev-Portal SPA asset-URL planner (CF.FILES.06 — iter-110).
 *
 * Pins the IPX URL contract the File-Manager lightbox uses to fetch
 * full-resolution previews. The planner is pure — these tests run
 * without a Bun process, browser, or testcontainer.
 */
import { describe, expect, it } from "vitest";

import { buildIpxUrl, isPreviewableImage } from "../../src/core/dx/clients/lib/asset-url.js";

describe("Story · asset-url planner", () => {
  describe("buildIpxUrl", () => {
    it("builds a width-modifier URL", () => {
      expect(buildIpxUrl({ storageKey: "tenants/a/folders/x/file.png", width: 1600 })).toBe(
        "/_ipx/w_1600/tenants/a/folders/x/file.png",
      );
    });

    it("composes modifiers in canonical order (w → h → f → fit)", () => {
      expect(
        buildIpxUrl({
          storageKey: "x.png",
          width: 100,
          height: 200,
          format: "webp",
          fit: "cover",
        }),
      ).toBe("/_ipx/w_100,h_200,f_webp,fit_cover/x.png");
    });

    it("falls back to the bare passthrough modifier when no transforms apply", () => {
      expect(buildIpxUrl({ storageKey: "raw.bin" })).toBe("/_ipx/_/raw.bin");
    });

    it("normalises storage keys with a leading slash", () => {
      expect(buildIpxUrl({ storageKey: "/tenants/a/file.png", width: 800 })).toBe(
        "/_ipx/w_800/tenants/a/file.png",
      );
    });

    it("ignores zero or negative widths/heights — they're nonsensical for IPX", () => {
      expect(buildIpxUrl({ storageKey: "x.png", width: 0, height: -10 })).toBe("/_ipx/_/x.png");
    });
  });

  describe("isPreviewableImage", () => {
    it.each([
      ["image/png", true],
      ["image/jpeg", true],
      ["image/webp", true],
      ["image/avif", true],
      ["image/gif", true],
      ["image/svg+xml", false],
      ["application/pdf", false],
      ["text/plain", false],
      ["", false],
    ])("returns %s for %s", (mime, expected) => {
      expect(isPreviewableImage(mime)).toBe(expected);
    });
  });
});
