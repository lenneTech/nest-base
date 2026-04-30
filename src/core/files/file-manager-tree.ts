/**
 * File-Manager folder-tree planner.
 *
 * Pure function: turns a flat `FolderRecord[]` into a recursive tree
 * sorted alphabetically (case-insensitive) at every level. The Dev-Portal
 * File-Manager renders this tree on the left side of the two-column
 * layout. Keeping the algorithm pure so the React component never has
 * to maintain incremental insertion logic.
 *
 * The planner tolerates corrupt input — orphans (parentId pointing at
 * an unknown folder) get promoted to root; cycles are broken
 * deterministically. A half-loaded list still renders rather than
 * crashing the UI.
 *
 * Story coverage: `tests/stories/file-manager-tree.story.test.ts`.
 */

export interface FolderTreeInput {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
}

export interface FolderTreePathSegment {
  id: string;
  name: string;
}

export interface FolderTreeNode {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
  depth: number;
  /** Root-to-node trail. The last entry is the node itself. */
  path: FolderTreePathSegment[];
  children: FolderTreeNode[];
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Build a recursive tree from a flat folder list.
 *
 * Algorithm:
 *   1. Index folders by id; track which ids exist.
 *   2. For each folder, decide its effective parent:
 *      - `null` if `parentId` is null or unknown (orphan promoted to root)
 *      - the resolved parent otherwise
 *   3. Walk roots down; on each step we track the visited set so
 *      cycles cannot recurse forever.
 *   4. Sort siblings on every level by name (case-insensitive,
 *      numeric-aware so `Folder 2` < `Folder 10`).
 */
export function buildFolderTree(input: readonly FolderTreeInput[]): FolderTreeNode[] {
  const byId = new Map<string, FolderTreeInput>();
  for (const folder of input) {
    byId.set(folder.id, folder);
  }

  const childrenByParent = new Map<string | null, FolderTreeInput[]>();
  for (const folder of input) {
    const parent = folder.parentId !== null && byId.has(folder.parentId) ? folder.parentId : null;
    const list = childrenByParent.get(parent) ?? [];
    list.push(folder);
    childrenByParent.set(parent, list);
  }

  // Cycle break: when every folder has a known parent (no nulls), the
  // root list is empty. We promote one node per orphan-cluster up to
  // root so the entire input still surfaces. The promoted node is the
  // lexicographically first id that hasn't been reached from the
  // synthetic root yet — deterministic across reruns.
  const reachable = new Set<string>();
  const collectReachable = (parentId: string | null, visited: Set<string>): void => {
    const list = childrenByParent.get(parentId) ?? [];
    for (const f of list) {
      if (visited.has(f.id)) continue;
      visited.add(f.id);
      reachable.add(f.id);
      collectReachable(f.id, visited);
    }
  };
  collectReachable(null, new Set<string>());
  if (reachable.size < input.length) {
    const orphanIds = input
      .map((f) => f.id)
      .filter((id) => !reachable.has(id))
      .sort();
    for (const id of orphanIds) {
      if (reachable.has(id)) continue;
      const folder = byId.get(id);
      if (!folder) continue;
      // Detach: remove from its current parent's child list, attach as root.
      const oldParent = folder.parentId !== null && byId.has(folder.parentId) ? folder.parentId : null;
      const oldList = childrenByParent.get(oldParent);
      if (oldList) {
        childrenByParent.set(
          oldParent,
          oldList.filter((f) => f.id !== id),
        );
      }
      const rootList = childrenByParent.get(null) ?? [];
      rootList.push(folder);
      childrenByParent.set(null, rootList);
      // Walk the now-reachable subtree to mark its members.
      const visited = new Set<string>([id]);
      reachable.add(id);
      collectReachable(id, visited);
    }
  }

  // Cycle-detection: every node tracks the visited set on its way down
  // through `walk`. A folder that is its own ancestor is dropped from
  // its parent's children list — its subtree still surfaces because it
  // was already attached on a higher level.
  const walk = (
    parentId: string | null,
    depth: number,
    visited: ReadonlySet<string>,
    parentPath: readonly FolderTreePathSegment[],
  ): FolderTreeNode[] => {
    const raw = childrenByParent.get(parentId) ?? [];
    const sorted = [...raw].sort((a, b) => collator.compare(a.name, b.name));
    const out: FolderTreeNode[] = [];
    for (const folder of sorted) {
      if (visited.has(folder.id)) {
        continue;
      }
      const next = new Set(visited);
      next.add(folder.id);
      const path = [...parentPath, { id: folder.id, name: folder.name }];
      const children = walk(folder.id, depth + 1, next, path);
      out.push({
        id: folder.id,
        tenantId: folder.tenantId,
        parentId: folder.parentId,
        name: folder.name,
        depth,
        path,
        children,
      });
    }
    return out;
  };

  return walk(null, 0, new Set<string>(), []);
}
