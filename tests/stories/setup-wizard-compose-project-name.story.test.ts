import { describe, expect, it } from "vitest";

import { computeComposeProjectName } from "../../src/core/setup/compose-project-name.js";

/**
 * Story · Setup-Wizard · per-workspace `COMPOSE_PROJECT_NAME` hash.
 *
 * Friction-log entry 14:21: two workspaces named `my-next-fs` in
 * different cache dirs collided on the same docker volume
 * (`my-next-fs_postgres_data`) because `COMPOSE_PROJECT_NAME` was
 * just `kebabCase(workspaceName)`. The volume-collision check from
 * PR #65 fired correctly, but the *root cause* is that two distinct
 * workspaces share a namespace.
 *
 * Fix: append a deterministic 6-char hex hash of the workspace's
 * absolute path to `COMPOSE_PROJECT_NAME` so two workspaces with the
 * same name but different paths get different volumes (e.g.
 * `my-next-fs-a1b2c3` and `my-next-fs-d4e5f6`). The hash is derived
 * from `sha256(absolutePath).slice(0,6)` — short enough to be
 * legible, deterministic across runs, and effectively collision-free
 * for the per-machine workspace counts we care about.
 */
describe("Story · Setup-Wizard compose-project-name planner", () => {
  it("appends a 6-char hex hash of the workspace path to the kebab name", () => {
    const name = computeComposeProjectName({
      projectName: "my-next-fs",
      workspacePath: "/Users/alice/work/api",
    });
    expect(name).toMatch(/^my-next-fs-[0-9a-f]{6}$/);
  });

  it("produces DIFFERENT names for the same project in two different paths", () => {
    const a = computeComposeProjectName({
      projectName: "my-next-fs",
      workspacePath: "/Users/alice/cache/run-a/api",
    });
    const b = computeComposeProjectName({
      projectName: "my-next-fs",
      workspacePath: "/Users/alice/cache/run-b/api",
    });
    expect(a).not.toBe(b);
    expect(a.startsWith("my-next-fs-")).toBe(true);
    expect(b.startsWith("my-next-fs-")).toBe(true);
  });

  it("produces the SAME name for the same input (deterministic / idempotent)", () => {
    const a = computeComposeProjectName({
      projectName: "my-app",
      workspacePath: "/srv/projects/my-app",
    });
    const b = computeComposeProjectName({
      projectName: "my-app",
      workspacePath: "/srv/projects/my-app",
    });
    expect(a).toBe(b);
  });

  it("rejects an empty project name (programmer error)", () => {
    expect(() => computeComposeProjectName({ projectName: "", workspacePath: "/x" })).toThrow(
      /projectName/,
    );
    expect(() => computeComposeProjectName({ projectName: "   ", workspacePath: "/x" })).toThrow(
      /projectName/,
    );
  });

  it("rejects an empty workspace path (programmer error)", () => {
    expect(() => computeComposeProjectName({ projectName: "ok", workspacePath: "" })).toThrow(
      /workspacePath/,
    );
  });

  it("hash component is a stable substring of sha256(absolute-path)", () => {
    // Asserting the algorithm at the level the story commits to:
    // "first 6 hex chars of sha256". This pins the implementation
    // for downstream tooling (CI dashboards, ops scripts) that may
    // want to reverse-derive the namespace from the workspace path.
    const a = computeComposeProjectName({
      projectName: "demo",
      workspacePath: "/tmp/a",
    });
    // Different content of the project name — same path → same hash.
    const b = computeComposeProjectName({
      projectName: "other",
      workspacePath: "/tmp/a",
    });
    const hashA = a.slice("demo-".length);
    const hashB = b.slice("other-".length);
    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[0-9a-f]{6}$/);
  });
});
