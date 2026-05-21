/**
 * Pure planner: derive a per-workspace `COMPOSE_PROJECT_NAME`.
 *
 * Friction-log run 2026-05-03-14-19-34 entry 14:21: two workspaces
 * named the same in different cache dirs collided on the same docker
 * volume (`my-next-fs_postgres_data`). The volume-safety check fires,
 * but the *root cause* is that `COMPOSE_PROJECT_NAME` was just
 * `kebabCase(workspaceName)` — no path differentiator. Two different
 * paths could not own different volumes.
 *
 * Fix: append a 6-char hex hash of the workspace's absolute path so
 * two workspaces with the same project name in different paths get
 * different namespaces. The hash is short enough to read at a glance
 * (`my-next-fs-a1b2c3`), deterministic across runs (so re-running
 * `bun run setup` in the same workspace produces the same name), and
 * effectively collision-free for the per-machine workspace counts we
 * care about (≈2^24 buckets).
 */

import { createHash } from "node:crypto";

export interface ComposeProjectNameInput {
  /** The kebab-case project name (typically `package.json`'s `name`). */
  projectName: string;
  /** The absolute path of the workspace (stable across runs in the same dir). */
  workspacePath: string;
}

const HASH_LENGTH = 6;

export function computeComposeProjectName(input: ComposeProjectNameInput): string {
  if (!input.projectName || input.projectName.trim().length === 0) {
    throw new Error("computeComposeProjectName: projectName is required");
  }
  if (!input.workspacePath || input.workspacePath.trim().length === 0) {
    throw new Error("computeComposeProjectName: workspacePath is required");
  }

  // docker compose project names must be lowercase, contain only
  // [a-z0-9_-], and start with a letter or number. A scoped workspace
  // name like "@bpa/api" would otherwise produce an invalid
  // "@bpa/api-<hash>" (the `@` and `/` are rejected). Strip the scope
  // marker, replace illegal runs with a single hyphen, and trim.
  const safeName = input.projectName
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (safeName.length === 0) {
    throw new Error(
      `computeComposeProjectName: projectName "${input.projectName}" has no docker-compatible characters`,
    );
  }

  // sha256 truncated to 6 hex chars. We deliberately do NOT normalise
  // the path (no realpath, no lower-casing) — same input → same hash
  // is exactly what we want, and any normalisation would couple this
  // function to a host filesystem's case-sensitivity rules.
  const hash = createHash("sha256").update(input.workspacePath).digest("hex").slice(0, HASH_LENGTH);

  return `${safeName}-${hash}`;
}
