/**
 * sync-to-template planner (PLAN.md §32 Phase 7).
 *
 * Inverse of sync-from-template. Given the local working tree and a
 * template `src/core/` snapshot, produce the patch payload that a PR
 * back to the template repo would carry. The CLI runner walks
 * `src/core/**` locally, clones the template repo to read its
 * matching tree, calls this planner, and writes
 * `core-pr.patch` for the user to inspect / `git am`.
 *
 *   - File only locally → add
 *   - File in both, drift → modify (with unified-diff body)
 *   - File in both, equal → skip
 *   - File only in template → remove (suggested)
 *   - Anything outside src/core/ on either side → ignored / rejected
 *
 * The planner stays I/O-free so:
 *   1. The diff body is reproducible (no random tmp dirs in headers).
 *   2. Tests don't shell out to git.
 *   3. The same call can power a GitLab/GitHub PR-creation runner.
 */

const CORE_PREFIX = "src/core/";

export interface SyncToTemplateInput {
  /** Local working tree — only `src/core/**` is in scope. */
  local: Record<string, string>;
  /** Template-side snapshot of `src/core/**`. */
  templateCore: Record<string, string>;
}

export interface SyncFileEntry {
  path: string;
  content: string;
}

export interface SyncFileModifyEntry extends SyncFileEntry {
  /** Unified diff body (no `diff --git` header — added by renderUnifiedPatch). */
  diff: string;
}

export interface SyncToTemplatePlan {
  add: SyncFileEntry[];
  modify: SyncFileModifyEntry[];
  skip: string[];
  remove: string[];
  summary: { add: number; modify: number; skip: number; remove: number };
  /** Concatenate every `modify` entry into a single multi-file `git apply`-able patch. */
  renderUnifiedPatch(): string;
}

export class ProtectedPathTouchedError extends Error {
  constructor(path: string) {
    super(`sync-to-template: refusing to read "${path}" — only src/core/ is in scope`);
    this.name = "ProtectedPathTouchedError";
  }
}

export function planSyncToTemplate(input: SyncToTemplateInput): SyncToTemplatePlan {
  for (const path of Object.keys(input.templateCore)) {
    if (!path.startsWith(CORE_PREFIX)) {
      throw new ProtectedPathTouchedError(path);
    }
  }

  const add: SyncFileEntry[] = [];
  const modify: SyncFileModifyEntry[] = [];
  const skip: string[] = [];
  const remove: string[] = [];

  // Pass 1 — process local src/core/ files (add / modify / skip).
  for (const path of Object.keys(input.local).sort()) {
    if (!path.startsWith(CORE_PREFIX)) continue;
    const localContent = input.local[path]!;
    const remoteContent = input.templateCore[path];
    if (remoteContent === undefined) {
      add.push({ path, content: localContent });
    } else if (remoteContent === localContent) {
      skip.push(path);
    } else {
      modify.push({
        path,
        content: localContent,
        diff: makeUnifiedDiff(path, remoteContent, localContent),
      });
    }
  }

  // Pass 2 — template-only files become suggested removals.
  for (const path of Object.keys(input.templateCore).sort()) {
    if (!(path in input.local)) {
      remove.push(path);
    }
  }

  return {
    add,
    modify,
    skip,
    remove,
    summary: {
      add: add.length,
      modify: modify.length,
      skip: skip.length,
      remove: remove.length,
    },
    renderUnifiedPatch(): string {
      return modify
        .map((entry) => `diff --git a/${entry.path} b/${entry.path}\n${entry.diff}`)
        .join("\n");
    },
  };
}

/**
 * Tiny unified-diff renderer — line-level, single hunk, no context
 * trimming. The output is good enough for `git apply --check` and
 * for human review; we deliberately don't pull in `diff` so the
 * dependency surface stays small.
 */
function makeUnifiedDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines: string[] = [];
  lines.push(`--- a/${path}`);
  lines.push(`+++ b/${path}`);
  lines.push(`@@ -1,${beforeLines.length} +1,${afterLines.length} @@`);
  for (const line of beforeLines) lines.push(`-${line}`);
  for (const line of afterLines) lines.push(`+${line}`);
  return lines.join("\n") + "\n";
}
