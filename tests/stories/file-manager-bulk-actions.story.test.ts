/**
 * Story · File-Manager bulk-action surface (CF.FILES.06 — iter-111).
 *
 * Pins the multi-select + bulk-delete UI contract by reading
 * `FileManagerPage.tsx`. The test isn't UI-level (no React renderer
 * dependency for the dev-portal subtree) but does prevent silent
 * regressions in the contract — selection state, mutation, and the
 * Toast message format. The lower-level mutation behaviour
 * (Promise.all over per-id DELETE) is asserted via a typed source
 * regex so a refactor that, say, replaces the per-id DELETE with a
 * single non-existent bulk endpoint surfaces immediately.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const PAGE_SRC = readFileSync(
  resolve(__dirname, "..", "..", "src/core/dx/clients/pages/FileManagerPage.tsx"),
  "utf8",
);

describe("Story · FileManagerPage bulk-action UI contract", () => {
  it("declares a selection-Set state slot scoped to file IDs", () => {
    expect(PAGE_SRC).toMatch(/setSelectedIds.*useState<Set<string>>/);
  });

  it("renders the BulkActionBar when files are visible", () => {
    expect(PAGE_SRC).toMatch(/<BulkActionBar/);
  });

  it("BulkActionBar exposes the canonical action quartet (select-all + clear + zip + delete)", () => {
    expect(PAGE_SRC).toMatch(/data-action="select-all"/);
    expect(PAGE_SRC).toMatch(/data-action="clear-selection"/);
    expect(PAGE_SRC).toMatch(/data-action="bulk-zip"/);
    expect(PAGE_SRC).toMatch(/data-action="bulk-delete"/);
  });

  it("bulk-zip mutation POSTs /files/zip with the selected ids and triggers a download", () => {
    expect(PAGE_SRC).toMatch(/fetch\("\/files\/zip", \{[\s\S]*?method: "POST"/);
    expect(PAGE_SRC).toMatch(/JSON\.stringify\(\{ ids \}\)/);
    expect(PAGE_SRC).toMatch(/document\.createElement\("a"\)/);
    expect(PAGE_SRC).toMatch(/link\.download = "files\.zip"/);
  });

  it("FileGrid emits one Checkbox per card with a stable data-action", () => {
    expect(PAGE_SRC).toMatch(/data-action="select-file"/);
  });

  it("bulkDelete mutation runs DELETE per id via Promise.all (not a single bulk endpoint)", () => {
    expect(PAGE_SRC).toMatch(/Promise\.all\(\s*ids\.map/);
    expect(PAGE_SRC).toMatch(/method: "DELETE"/);
  });

  it("bulk-delete success path resets the selection + invalidates the list", () => {
    expect(PAGE_SRC).toMatch(/setSelectedIds\(new Set\(\)\)/);
    expect(PAGE_SRC).toMatch(/invalidateQueries\(\{ queryKey: \["dev", "files", "list"\] \}\)/);
  });

  it("toast format encodes both succeeded + failed counts (German UI)", () => {
    expect(PAGE_SRC).toMatch(/Datei\(en\) gelöscht/);
    expect(PAGE_SRC).toMatch(/fehlgeschlagen/);
  });

  it("guards bulk-delete with a window.confirm prompt that includes the count", () => {
    expect(PAGE_SRC).toMatch(/window\.confirm\(.*Datei\(en\) löschen/);
  });

  it("Auswahl-leeren button is disabled when nothing is selected", () => {
    // Look for the disabled binding tied to selectedIds.size on the
    // clear-selection action — the BulkActionBar literal has both.
    expect(PAGE_SRC).toMatch(/disabled=\{selectedIds\.size === 0\}/);
  });
});
