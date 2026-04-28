/**
 * sync-from-template planner (PLAN.md §32 Phase 7).
 *
 * Pure function: given the template repo's `src/core/` snapshot and
 * the local working tree, return the file operations needed to bring
 * the local copy up to date — without ever touching `src/modules/` or
 * any path outside `src/core/`.
 *
 * The CLI script (next sub-task) clones the template repo to a temp
 * dir, reads `src/core/**`, calls this planner, and applies the
 * operations through fs-promises. Keeping the planner I/O-free buys
 * us deterministic output, fully unit-testable behaviour, and a hard
 * boundary for the "don't touch modules/" guarantee that the user is
 * trusting.
 *
 * Defense-in-depth: the planner refuses any template path outside
 * `src/core/` so a misconfigured runner (or a maliciously-crafted
 * template) can't smuggle writes into the local modules tree.
 */

const CORE_PREFIX = 'src/core/';

export interface SyncFromTemplateInput {
  /** Template-side snapshot of `src/core/**` — keys are repo-relative paths. */
  templateCore: Record<string, string>;
  /** Local working tree — anything outside src/core/ is read-only here. */
  local: Record<string, string>;
}

export interface SyncFileWrite {
  path: string;
  content: string;
}

export interface SyncFromTemplatePlan {
  create: SyncFileWrite[];
  update: SyncFileWrite[];
  skip: string[];
  delete: string[];
  summary: { create: number; update: number; skip: number; delete: number };
}

export class ProtectedPathTouchedError extends Error {
  constructor(path: string) {
    super(`sync-from-template: refusing to touch "${path}" — only src/core/ is in scope`);
    this.name = 'ProtectedPathTouchedError';
  }
}

export function planSyncFromTemplate(input: SyncFromTemplateInput): SyncFromTemplatePlan {
  for (const path of Object.keys(input.templateCore)) {
    if (!path.startsWith(CORE_PREFIX)) {
      throw new ProtectedPathTouchedError(path);
    }
  }

  const create: SyncFileWrite[] = [];
  const update: SyncFileWrite[] = [];
  const skip: string[] = [];
  const remoteDelete: string[] = [];

  // Pass 1 — process template-side files (create / update / skip).
  for (const path of Object.keys(input.templateCore).sort()) {
    const remoteContent = input.templateCore[path]!;
    const localContent = input.local[path];
    if (localContent === undefined) {
      create.push({ path, content: remoteContent });
    } else if (localContent === remoteContent) {
      skip.push(path);
    } else {
      update.push({ path, content: remoteContent });
    }
  }

  // Pass 2 — locally-only src/core/ files become deletes.
  for (const path of Object.keys(input.local).sort()) {
    if (!path.startsWith(CORE_PREFIX)) continue;
    if (path in input.templateCore) continue;
    remoteDelete.push(path);
  }

  return {
    create,
    update,
    skip,
    delete: remoteDelete,
    summary: {
      create: create.length,
      update: update.length,
      skip: skip.length,
      delete: remoteDelete.length,
    },
  };
}
