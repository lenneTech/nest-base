/**
 * Story · File-Manager breadcrumb planner.
 *
 * The breadcrumb above the file grid shows `Root / customers / acme /
 * invoices` for a deeply-nested folder. The planner walks the parent
 * chain from the active folder back to the root, collecting display
 * names. A `null` activeId returns the synthetic "Root" segment alone.
 */
import { describe, expect, it } from "vitest";

import {
  buildFolderBreadcrumb,
  type BreadcrumbInput,
} from "../../src/core/files/file-manager-breadcrumb.js";

const TENANT = "00000000-0000-0000-0000-000000000001";

function f(id: string, name: string, parentId: string | null = null): BreadcrumbInput {
  return { id, name, parentId, tenantId: TENANT };
}

describe("Story · File-Manager breadcrumb planner", () => {
  it("returns a single Root segment when activeId is null", () => {
    const crumbs = buildFolderBreadcrumb({ activeId: null, folders: [] });
    expect(crumbs).toEqual([{ id: null, name: "Root" }]);
  });

  it("walks the parent chain back to the root for a nested folder", () => {
    const crumbs = buildFolderBreadcrumb({
      activeId: "leaf",
      folders: [f("root", "customers"), f("mid", "acme", "root"), f("leaf", "invoices", "mid")],
    });
    expect(crumbs).toEqual([
      { id: null, name: "Root" },
      { id: "root", name: "customers" },
      { id: "mid", name: "acme" },
      { id: "leaf", name: "invoices" },
    ]);
  });

  it("returns just Root + active when the folder has no parent", () => {
    const crumbs = buildFolderBreadcrumb({
      activeId: "single",
      folders: [f("single", "Solo")],
    });
    expect(crumbs).toEqual([
      { id: null, name: "Root" },
      { id: "single", name: "Solo" },
    ]);
  });

  it("breaks gracefully when the activeId is not in the folders list", () => {
    const crumbs = buildFolderBreadcrumb({
      activeId: "missing",
      folders: [f("root", "Root-Folder")],
    });
    // Unknown active folder degrades to the synthetic Root segment.
    expect(crumbs).toEqual([{ id: null, name: "Root" }]);
  });

  it("breaks parent cycles without infinite recursion", () => {
    const crumbs = buildFolderBreadcrumb({
      activeId: "a",
      folders: [
        { id: "a", name: "A", parentId: "b", tenantId: TENANT },
        { id: "b", name: "B", parentId: "a", tenantId: TENANT },
      ],
    });
    // The walk stops when it sees a folder it already visited; the
    // returned chain is finite.
    expect(crumbs.length).toBeLessThanOrEqual(4);
    expect(crumbs[0]).toEqual({ id: null, name: "Root" });
  });
});
