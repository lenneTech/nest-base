/**
 * Story · File-Manager folder-tree planner.
 *
 * The dev-portal File-Manager renders a recursive folder tree on the
 * left side. The shape is built from a flat list of `FolderRecord`s
 * (one tenant, no nesting metadata baked into the row beyond
 * `parentId`). The planner is pure — given a flat list, it returns a
 * deterministic tree rooted at the synthetic `null` parent — so the
 * React tree never has to build it incrementally.
 *
 * Locking:
 *   - children are sorted by name (case-insensitive) for stable rendering
 *   - orphan rows (parentId pointing at an unknown id) are silently
 *     promoted to root so a half-loaded list never disappears
 *   - cycles are broken (first-write-wins) so a corrupt parent chain
 *     can't crash the renderer
 */
import { describe, expect, it } from "vitest";

import {
  buildFolderTree,
  type FolderTreeInput,
  type FolderTreeNode,
} from "../../src/core/files/file-manager-tree.js";

const TENANT = "00000000-0000-0000-0000-000000000001";

function f(id: string, name: string, parentId: string | null = null): FolderTreeInput {
  return { id, name, parentId, tenantId: TENANT };
}

describe("Story · File-Manager folder-tree planner", () => {
  it("returns an empty array when the input is empty", () => {
    expect(buildFolderTree([])).toEqual([]);
  });

  it("builds a single root for a flat list of root folders sorted by name", () => {
    const tree = buildFolderTree([f("a", "Beta"), f("b", "Alpha"), f("c", "Gamma")]);
    expect(tree).toHaveLength(3);
    expect(tree.map((n: FolderTreeNode) => n.name)).toEqual(["Alpha", "Beta", "Gamma"]);
    for (const node of tree) {
      expect(node.children).toEqual([]);
      expect(node.depth).toBe(0);
    }
  });

  it("nests children under their parents and sorts each level alphabetically", () => {
    const tree = buildFolderTree([
      f("root", "Root"),
      f("c1", "Charlie", "root"),
      f("c2", "Alpha", "root"),
      f("c3", "Bravo", "root"),
      f("gc", "Inner", "c2"),
    ]);
    expect(tree).toHaveLength(1);
    const root = tree[0]!;
    expect(root.children.map((c) => c.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(root.children[0]!.children).toHaveLength(1);
    expect(root.children[0]!.children[0]!.name).toBe("Inner");
    expect(root.children[0]!.children[0]!.depth).toBe(2);
  });

  it("uses case-insensitive name sort so 'a' and 'A' interleave naturally", () => {
    const tree = buildFolderTree([f("1", "alpha"), f("2", "Bravo"), f("3", "ALPHA-2")]);
    expect(tree.map((n) => n.name)).toEqual(["alpha", "ALPHA-2", "Bravo"]);
  });

  it("promotes orphans (unknown parentId) to root so a partial load still renders", () => {
    const tree = buildFolderTree([f("a", "Anchor"), f("orphan", "Orphan", "missing-parent")]);
    // Orphan is at the root level; the root array has both nodes.
    expect(tree.map((n) => n.name).sort()).toEqual(["Anchor", "Orphan"]);
  });

  it("breaks cycles deterministically so corrupt input never loops", () => {
    // a → b → c → a (cycle). Planner should pick one as root and
    // attach the other two as children, never recursing forever.
    const tree = buildFolderTree([
      { id: "a", name: "A", parentId: "c", tenantId: TENANT },
      { id: "b", name: "B", parentId: "a", tenantId: TENANT },
      { id: "c", name: "C", parentId: "b", tenantId: TENANT },
    ]);
    // Result is finite — we don't blow the stack.
    const collectIds = (nodes: FolderTreeNode[], acc: string[] = []): string[] => {
      for (const n of nodes) {
        acc.push(n.id);
        collectIds(n.children, acc);
      }
      return acc;
    };
    const ids = collectIds(tree);
    expect(ids).toHaveLength(3);
    expect(new Set(ids)).toEqual(new Set(["a", "b", "c"]));
  });

  it("attaches a `path` array tracing root-to-node for breadcrumb lookups", () => {
    const tree = buildFolderTree([
      f("root", "Root"),
      f("mid", "Mid", "root"),
      f("leaf", "Leaf", "mid"),
    ]);
    const root = tree[0]!;
    expect(root.path.map((p) => p.id)).toEqual(["root"]);
    const mid = root.children[0]!;
    expect(mid.path.map((p) => p.id)).toEqual(["root", "mid"]);
    const leaf = mid.children[0]!;
    expect(leaf.path.map((p) => p.id)).toEqual(["root", "mid", "leaf"]);
  });
});
