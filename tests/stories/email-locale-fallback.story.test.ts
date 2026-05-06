import { describe, expect, it } from "vitest";

/**
 * Story · Email locale fallback chain (CF.EMAIL.09).
 *
 * The PRD's `CF.EMAIL.09` requires the email layer to consult the
 * recipient's preferred locale, then fall back through a deterministic
 * chain when the requested locale isn't available for a given template.
 *
 * Fallback chain rules (specific → generic → default):
 *   1. Exact match on the user's preferred locale (e.g. `de-AT`).
 *   2. Language root (e.g. `de`) when the regional variant isn't
 *      available — `de-AT` falls through to `de` if templates lack
 *      `<name>.de-AT.tsx` but ship `<name>.de.tsx`.
 *   3. The configured default locale (e.g. `en`) — last-resort, never
 *      rejected even if the template doesn't exist (the email pipeline
 *      surfaces the missing-template error separately).
 *
 * The planner is pure: given a candidate locale, default locale, and
 * the set of available locales, it returns the ordered try-chain. The
 * runner (EmailService) walks that chain at send time.
 */
describe("Story · Email locale fallback chain", () => {
  describe("resolveLocaleFallbackChain — happy paths", () => {
    it("returns the user locale first when it is available", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: "de",
        defaultLocale: "en",
        availableLocales: ["de", "en"],
      });
      expect(chain).toEqual(["de", "en"]);
    });

    it("falls back from regional variant to language root", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: "de-AT",
        defaultLocale: "en",
        availableLocales: ["de", "en"],
      });
      // de-AT not available → de (root) → en (default)
      expect(chain).toEqual(["de", "en"]);
    });

    it("returns regional variant first when both regional and root are available", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: "de-AT",
        defaultLocale: "en",
        availableLocales: ["de", "de-AT", "en"],
      });
      expect(chain).toEqual(["de-AT", "de", "en"]);
    });

    it("falls all the way to the default when nothing matches", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: "ja-JP",
        defaultLocale: "en",
        availableLocales: ["en"],
      });
      expect(chain).toEqual(["en"]);
    });

    it("dedupes when user locale equals default locale", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: "en",
        defaultLocale: "en",
        availableLocales: ["en", "de"],
      });
      expect(chain).toEqual(["en"]);
    });
  });

  describe("resolveLocaleFallbackChain — edge cases", () => {
    it("treats undefined userLocale as default-only", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: undefined,
        defaultLocale: "en",
        availableLocales: ["en", "de"],
      });
      expect(chain).toEqual(["en"]);
    });

    it("treats empty userLocale as default-only", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: "",
        defaultLocale: "en",
        availableLocales: ["en", "de"],
      });
      expect(chain).toEqual(["en"]);
    });

    it("normalises case (de-AT and DE-at refer to the same locale)", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: "DE-at",
        defaultLocale: "en",
        availableLocales: ["de-AT", "en"],
      });
      expect(chain).toEqual(["de-AT", "en"]);
    });

    it("returns the default even when it isn't in availableLocales (last-resort guarantee)", async () => {
      const { resolveLocaleFallbackChain } =
        await import("../../src/core/email/locale-fallback.js");
      const chain = resolveLocaleFallbackChain({
        userLocale: "de",
        defaultLocale: "en",
        availableLocales: ["fr"],
      });
      // `de` isn't in available, `en` isn't either — but the default is
      // the last-resort fallback the runner walks toward.
      expect(chain).toEqual(["en"]);
    });
  });
});
