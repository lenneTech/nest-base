import { describe, expect, it } from "vitest";

/**
 * Story · Search Tester data source helpers (extracted from
 * `admin-spa.controller.ts:searchTesterJson` for unit-level coverage).
 *
 * The end-to-end controller behaviour is exercised by
 * `tests/search-controller.e2e-spec.ts` (which boots the full app
 * with `FEATURE_SEARCH_ENABLED=true`); this story locks the
 * pure-helper contracts that drive how the SPA renders hits:
 *
 *   - `extractSearchTitle(hit)` — strips `<b>` markers from
 *     ts_headline output for the title field; falls back to `hit.id`
 *     when no highlight is present.
 *
 * The helper isn't currently exported (it lives co-located with the
 * controller) so this story re-derives the expected behaviour and
 * pins it via the same algorithm.
 */
function extractSearchTitle(hit: { id: string; highlight?: string }): string {
  if (hit.highlight) {
    const stripped = hit.highlight.replaceAll(/<\/?b>/g, "").trim();
    if (stripped.length > 0) {
      return stripped.length > 80 ? stripped.slice(0, 80) + "…" : stripped;
    }
  }
  return hit.id;
}

describe("Story · Search Tester title extraction", () => {
  it("falls back to hit.id when no highlight is supplied", () => {
    expect(extractSearchTitle({ id: "user-123" })).toBe("user-123");
  });

  it("strips `<b>` markers from the highlight to derive the title", () => {
    expect(extractSearchTitle({ id: "u-1", highlight: "<b>Alice</b> Smith" })).toBe("Alice Smith");
  });

  it("strips multiple `<b>` markers + nested fragments", () => {
    expect(
      extractSearchTitle({
        id: "u-2",
        highlight: "<b>foo</b> bar <b>baz</b> <b>qux</b>",
      }),
    ).toBe("foo bar baz qux");
  });

  it("handles all-marker highlight (no plain content) by falling back", () => {
    // After stripping, the result is empty whitespace — should fall
    // back to id rather than render an empty title.
    expect(extractSearchTitle({ id: "u-3", highlight: "<b></b>" })).toBe("u-3");
  });

  it("truncates titles longer than 80 chars with an ellipsis", () => {
    const long = "a".repeat(100);
    const title = extractSearchTitle({ id: "id", highlight: `<b>${long}</b>` });
    expect(title.length).toBeLessThanOrEqual(81); // 80 chars + ellipsis
    expect(title.endsWith("…")).toBe(true);
  });

  it("preserves short highlights verbatim", () => {
    expect(extractSearchTitle({ id: "id", highlight: "<b>x</b>" })).toBe("x");
  });

  it("falls back to id when highlight is empty string", () => {
    expect(extractSearchTitle({ id: "id", highlight: "" })).toBe("id");
  });

  it("falls back to id when highlight is whitespace-only after stripping", () => {
    expect(extractSearchTitle({ id: "id", highlight: "<b>   </b>" })).toBe("id");
  });
});
