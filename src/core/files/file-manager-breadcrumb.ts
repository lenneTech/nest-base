/**
 * File-Manager breadcrumb planner.
 *
 * Walks the parent chain from `activeId` back to the root, returning a
 * list of `{ id, name }` segments. The synthetic "Root" segment with
 * `id: null` always sits at the head so the UI can render
 * `Root / customers / acme / invoices`.
 *
 * Story coverage: `tests/stories/file-manager-breadcrumb.story.test.ts`.
 */

export interface BreadcrumbInput {
  id: string;
  tenantId: string;
  parentId: string | null;
  name: string;
}

export interface BreadcrumbSegment {
  id: string | null;
  name: string;
}

export interface BuildBreadcrumbOptions {
  activeId: string | null;
  folders: readonly BreadcrumbInput[];
}

/**
 * Returns Root → … → active. The walk is bounded by the visited set
 * so a corrupt parent chain cannot loop forever.
 */
export function buildFolderBreadcrumb(opts: BuildBreadcrumbOptions): BreadcrumbSegment[] {
  const root: BreadcrumbSegment = { id: null, name: "Root" };
  if (opts.activeId === null) return [root];

  const byId = new Map<string, BreadcrumbInput>();
  for (const folder of opts.folders) {
    byId.set(folder.id, folder);
  }

  const active = byId.get(opts.activeId);
  if (!active) return [root];

  // Walk parents until we hit the root or a cycle. The path is built
  // tail-first then reversed.
  const tail: BreadcrumbSegment[] = [];
  const visited = new Set<string>();
  let cursor: BreadcrumbInput | undefined = active;
  while (cursor && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    tail.push({ id: cursor.id, name: cursor.name });
    if (cursor.parentId === null) break;
    cursor = byId.get(cursor.parentId);
  }
  tail.reverse();
  return [root, ...tail];
}
