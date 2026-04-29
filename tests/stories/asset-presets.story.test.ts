import { describe, expect, it } from "vitest";

import {
  AssetPresetRegistry,
  AssetPresetNotFoundError,
  DEFAULT_ASSET_PRESETS,
  AssetPresetSchema,
} from "../../src/core/files/asset-presets.js";
import { InMemoryStorageAdapter } from "../../src/core/files/storage-adapter.js";
import { AssetService, type AssetTransformer } from "../../src/core/files/asset.service.js";

/**
 * Story · Asset-Presets (PLAN.md §8 + §32 Phase 4).
 *
 * Named transform profiles (`thumbnail`, `avatar`, `hero`, …) map to
 * a TransformOptions record. Presets restrict the set of valid URLs,
 * keep the cache hot, and let projects extend the framework defaults
 * without forking the asset service.
 */
describe("Story · Asset Presets", () => {
  describe("DEFAULT_ASSET_PRESETS", () => {
    it("ships baseline thumbnail / avatar / hero presets", () => {
      expect(DEFAULT_ASSET_PRESETS.thumbnail).toBeDefined();
      expect(DEFAULT_ASSET_PRESETS.avatar).toBeDefined();
      expect(DEFAULT_ASSET_PRESETS.hero).toBeDefined();
    });

    it("thumbnail is smaller than hero", () => {
      const thumb = DEFAULT_ASSET_PRESETS.thumbnail;
      const hero = DEFAULT_ASSET_PRESETS.hero;
      expect(thumb.width).toBeLessThan(hero.width!);
    });

    it("all defaults parse cleanly through AssetPresetSchema", () => {
      for (const [name, opts] of Object.entries(DEFAULT_ASSET_PRESETS)) {
        const result = AssetPresetSchema.safeParse(opts);
        expect(result.success, `preset=${name}`).toBe(true);
      }
    });
  });

  describe("AssetPresetSchema", () => {
    it("rejects width / height that are not positive", () => {
      expect(AssetPresetSchema.safeParse({ width: 0 }).success).toBe(false);
      expect(AssetPresetSchema.safeParse({ height: -1 }).success).toBe(false);
    });

    it("rejects unknown formats", () => {
      expect(AssetPresetSchema.safeParse({ format: "bmp" }).success).toBe(false);
    });

    it("rejects quality outside [1, 100]", () => {
      expect(AssetPresetSchema.safeParse({ quality: 0 }).success).toBe(false);
      expect(AssetPresetSchema.safeParse({ quality: 101 }).success).toBe(false);
    });
  });

  describe("AssetPresetRegistry", () => {
    it("register() + get() round-trip", () => {
      const reg = new AssetPresetRegistry();
      reg.register("square", { width: 300, height: 300, fit: "cover" });
      expect(reg.get("square")).toEqual({ width: 300, height: 300, fit: "cover" });
    });

    it("register() rejects an invalid preset", () => {
      const reg = new AssetPresetRegistry();
      expect(() => reg.register("bad", { width: -5 } as never)).toThrow();
    });

    it("register() throws on a duplicate name (collision is a wiring bug)", () => {
      const reg = new AssetPresetRegistry();
      reg.register("a", { width: 100 });
      expect(() => reg.register("a", { width: 200 })).toThrow(/duplicate/i);
    });

    it("get() throws AssetPresetNotFoundError on unknown name", () => {
      const reg = new AssetPresetRegistry();
      expect(() => reg.get("missing")).toThrow(AssetPresetNotFoundError);
    });

    it("fromDefaults() pre-populates the framework defaults", () => {
      const reg = AssetPresetRegistry.fromDefaults();
      expect(reg.get("thumbnail")).toEqual(DEFAULT_ASSET_PRESETS.thumbnail);
      expect(reg.get("avatar")).toEqual(DEFAULT_ASSET_PRESETS.avatar);
    });
  });

  describe("Integration with AssetService", () => {
    it("deliver-by-preset flows through the service + registry", async () => {
      const origin = new InMemoryStorageAdapter();
      const cache = new InMemoryStorageAdapter();
      const transformer: AssetTransformer = {
        async transform(bytes, options) {
          return {
            bytes: new TextEncoder().encode(`[${options.width}]${new TextDecoder().decode(bytes)}`),
            mimeType: "image/webp",
          };
        },
      };
      await origin.put({
        key: "avatar.png",
        body: new TextEncoder().encode("orig"),
        mimeType: "image/png",
      });

      const presets = AssetPresetRegistry.fromDefaults();
      const service = new AssetService({ origin, cache, transformer });

      const opts = presets.get("avatar");
      const result = await service.deliver("avatar.png", opts);

      expect(new TextDecoder().decode(result.bytes)).toBe(`[${opts.width}]orig`);
    });
  });
});
