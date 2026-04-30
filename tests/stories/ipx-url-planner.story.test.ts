import { describe, expect, it } from "vitest";

import {
  buildIpxModifierString,
  legacyQueryToIpxModifiers,
  resolvePresetModifiers,
} from "../../src/core/files/ipx-url-planner.js";
import { AssetPresetRegistry } from "../../src/core/files/asset-presets.js";

/**
 * Story · IPX URL planner.
 *
 * Pure planners that translate the legacy `/assets/:key?width=…&format=…`
 * query-param API into IPX's `/_ipx/<modifiers>/<source>` URL syntax,
 * and resolve named presets (e.g. `preset_thumbnail`) to a concrete
 * IPX modifier string.
 *
 * IPX modifier syntax:
 *   `<key>_<value>` separated by `,`. Keys are short forms (w, h, q, f, fit).
 *
 * Issue #17 keeps the legacy URL working for backwards-compat by
 * re-routing `/assets/:key?width=…` requests through the IPX engine.
 */
describe("Story · IPX URL planner", () => {
  describe("legacyQueryToIpxModifiers()", () => {
    it("translates width / height / format / quality / fit into IPX modifiers", () => {
      expect(
        legacyQueryToIpxModifiers({
          width: "300",
          height: "200",
          format: "webp",
          quality: "80",
          fit: "cover",
        }),
      ).toEqual({
        w: "300",
        h: "200",
        f: "webp",
        q: "80",
        fit: "cover",
      });
    });

    it("ignores unknown query params (defense-in-depth)", () => {
      expect(
        legacyQueryToIpxModifiers({
          width: "100",
          // Attacker tries to smuggle an extra modifier through the
          // legacy adapter — we only forward the documented allow-list.
          rotate: "90",
          junk: "exploit",
        }),
      ).toEqual({ w: "100" });
    });

    it("returns an empty object when no transform is requested", () => {
      expect(legacyQueryToIpxModifiers({})).toEqual({});
    });

    it("rejects formats outside the documented allow-list (silently drops)", () => {
      expect(
        legacyQueryToIpxModifiers({ width: "100", format: "tiff" }),
      ).toEqual({ w: "100" });
    });

    it("rejects fit values outside the documented allow-list", () => {
      expect(legacyQueryToIpxModifiers({ width: "100", fit: "weird" })).toEqual({
        w: "100",
      });
    });

    it("clamps numeric values: only positive integers are accepted", () => {
      expect(legacyQueryToIpxModifiers({ width: "-1" })).toEqual({});
      expect(legacyQueryToIpxModifiers({ width: "0" })).toEqual({});
      expect(legacyQueryToIpxModifiers({ width: "abc" })).toEqual({});
      expect(legacyQueryToIpxModifiers({ quality: "150" })).toEqual({});
      expect(legacyQueryToIpxModifiers({ quality: "0" })).toEqual({});
    });
  });

  describe("buildIpxModifierString()", () => {
    it("emits an empty modifier string `_` when no modifiers", () => {
      expect(buildIpxModifierString({})).toBe("_");
    });

    it("emits `<key>_<value>` separated by commas in stable key order", () => {
      // Stable order (sorted) keeps the produced URL deterministic so
      // CDN cache hits match across calls regardless of input ordering.
      expect(buildIpxModifierString({ w: "300", f: "webp" })).toBe(
        "f_webp,w_300",
      );
      expect(buildIpxModifierString({ f: "webp", w: "300" })).toBe(
        "f_webp,w_300",
      );
    });

    it("emits all known modifiers", () => {
      expect(
        buildIpxModifierString({
          w: "300",
          h: "200",
          f: "webp",
          q: "80",
          fit: "cover",
        }),
      ).toBe("f_webp,fit_cover,h_200,q_80,w_300");
    });
  });

  describe("resolvePresetModifiers()", () => {
    it("expands a registered preset name into the matching modifiers", () => {
      const registry = AssetPresetRegistry.fromDefaults();
      const modifiers = resolvePresetModifiers("thumbnail", registry);
      expect(modifiers).toEqual({
        w: "200",
        h: "200",
        f: "webp",
        q: "75",
        fit: "cover",
      });
    });

    it("throws when the preset name is unknown", () => {
      const registry = AssetPresetRegistry.fromDefaults();
      expect(() => resolvePresetModifiers("nope", registry)).toThrow();
    });
  });
});
