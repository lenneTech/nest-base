/**
 * Story · File-Manager sort + filter planner.
 *
 * The file-grid lets the user sort by name / size / created-at /
 * mime-type and filter by a free-text search string. The planner is
 * pure so the React grid never re-implements the algorithm and the
 * server can run the same code for the > 500-file fallback.
 */
import { describe, expect, it } from "vitest";

import {
  applyFileSearch,
  type FileSearchInput,
  type FileSearchOptions,
} from "../../src/core/files/file-manager-search.js";

function file(input: Partial<FileSearchInput> & { id: string }): FileSearchInput {
  return {
    id: input.id,
    filename: input.filename ?? `${input.id}.txt`,
    mimeType: input.mimeType ?? "text/plain",
    sizeBytes: input.sizeBytes ?? 0,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("Story · File-Manager sort + filter planner", () => {
  describe("filtering", () => {
    it("returns the input unchanged when no filter is supplied", () => {
      const files = [file({ id: "a" }), file({ id: "b" })];
      const out = applyFileSearch(files, {});
      expect(out.map((f) => f.id)).toEqual(["a", "b"]);
    });

    it("filters by case-insensitive substring on filename", () => {
      const files = [
        file({ id: "1", filename: "Invoice-2024.pdf" }),
        file({ id: "2", filename: "report.docx" }),
        file({ id: "3", filename: "INVOICE-2025.pdf" }),
      ];
      const out = applyFileSearch(files, { search: "invoice" });
      expect(out.map((f) => f.id).sort()).toEqual(["1", "3"]);
    });

    it("filters by mimeType prefix when the search ends in `/*`", () => {
      const files = [
        file({ id: "img", mimeType: "image/png" }),
        file({ id: "doc", mimeType: "application/pdf" }),
        file({ id: "img2", mimeType: "image/jpeg" }),
      ];
      const out = applyFileSearch(files, { mimeTypePrefix: "image/" });
      expect(out.map((f) => f.id).sort()).toEqual(["img", "img2"]);
    });

    it("combines search and mime filter (AND)", () => {
      const files = [
        file({ id: "a", filename: "logo.png", mimeType: "image/png" }),
        file({ id: "b", filename: "logo.pdf", mimeType: "application/pdf" }),
        file({ id: "c", filename: "hero.png", mimeType: "image/png" }),
      ];
      const out = applyFileSearch(files, { search: "logo", mimeTypePrefix: "image/" });
      expect(out.map((f) => f.id)).toEqual(["a"]);
    });
  });

  describe("sorting", () => {
    const files = [
      file({ id: "1", filename: "beta.txt", sizeBytes: 100, createdAt: "2026-01-02T00:00:00Z" }),
      file({ id: "2", filename: "Alpha.txt", sizeBytes: 50, createdAt: "2026-01-01T00:00:00Z" }),
      file({ id: "3", filename: "gamma.txt", sizeBytes: 200, createdAt: "2026-01-03T00:00:00Z" }),
    ];

    it("sorts by name ascending (case-insensitive) by default", () => {
      const out = applyFileSearch(files, {});
      expect(out.map((f) => f.id)).toEqual(["2", "1", "3"]);
    });

    it("sorts by size ascending when sortBy is 'size'", () => {
      const out = applyFileSearch(files, { sortBy: "size" });
      expect(out.map((f) => f.id)).toEqual(["2", "1", "3"]);
    });

    it("reverses with sortDirection='desc'", () => {
      const out = applyFileSearch(files, { sortBy: "size", sortDirection: "desc" });
      expect(out.map((f) => f.id)).toEqual(["3", "1", "2"]);
    });

    it("sorts by createdAt", () => {
      const out = applyFileSearch(files, { sortBy: "createdAt" });
      expect(out.map((f) => f.id)).toEqual(["2", "1", "3"]);
    });

    it("sorts by mimeType lexicographically", () => {
      const mixed = [
        file({ id: "x", mimeType: "image/png", filename: "a" }),
        file({ id: "y", mimeType: "application/pdf", filename: "a" }),
        file({ id: "z", mimeType: "text/plain", filename: "a" }),
      ];
      const out = applyFileSearch(mixed, { sortBy: "mimeType" });
      expect(out.map((f) => f.id)).toEqual(["y", "x", "z"]);
    });

    it("ignores unknown sortBy values and falls back to name asc", () => {
      const out = applyFileSearch(files, { sortBy: "garbage" as unknown as FileSearchOptions["sortBy"] });
      expect(out.map((f) => f.id)).toEqual(["2", "1", "3"]);
    });
  });

  describe("limit", () => {
    it("applies the optional `limit` cap so the client never renders more than asked", () => {
      const files = Array.from({ length: 50 }, (_, i) =>
        file({ id: `f-${i}`, filename: `name-${i}.txt` }),
      );
      const out = applyFileSearch(files, { limit: 10 });
      expect(out).toHaveLength(10);
    });
  });
});
