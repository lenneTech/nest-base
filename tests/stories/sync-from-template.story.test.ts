import { describe, expect, it } from "vitest";

import {
  ProtectedPathTouchedError,
  planSyncFromTemplate,
} from "../../src/core/setup/sync-from-template.js";

/**
 * Story · sync:from-template (PLAN.md §32 Phase 7).
 *
 * Pure planner: given a snapshot of the template repo's `src/core/`
 * tree and the local working tree, return the list of file
 * operations needed to bring the local copy up to date — without
 * ever touching `src/modules/` or files outside `src/core/`.
 *
 *   - File only in template  → create  (under src/core/)
 *   - File in both, content differs → update
 *   - File in both, content equal   → skip
 *   - File only in local under src/core/ → delete
 *   - Anything outside src/core/ in the template snapshot → reject
 *     (defense in depth — the script must not import non-core paths)
 */
describe("Story · sync:from-template planner", () => {
  function defaultLocal(): Record<string, string> {
    return {
      "src/modules/projects/projects.service.ts": "export class ProjectsService {}",
      "src/modules/projects/projects.module.ts": "export class ProjectsModule {}",
    };
  }

  it("creates a file that exists only in the template", () => {
    const plan = planSyncFromTemplate({
      templateCore: { "src/core/auth/better-auth.ts": "export const a = 1;" },
      local: defaultLocal(),
    });
    expect(plan.create).toEqual([
      { path: "src/core/auth/better-auth.ts", content: "export const a = 1;" },
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.delete).toEqual([]);
    expect(plan.skip).toEqual([]);
  });

  it("updates a file whose content has drifted", () => {
    const plan = planSyncFromTemplate({
      templateCore: { "src/core/auth/better-auth.ts": "export const a = 2;" },
      local: { ...defaultLocal(), "src/core/auth/better-auth.ts": "export const a = 1;" },
    });
    expect(plan.update).toEqual([
      { path: "src/core/auth/better-auth.ts", content: "export const a = 2;" },
    ]);
    expect(plan.create).toEqual([]);
  });

  it("skips a file whose content already matches the template", () => {
    const plan = planSyncFromTemplate({
      templateCore: { "src/core/auth/better-auth.ts": "export const a = 1;" },
      local: { ...defaultLocal(), "src/core/auth/better-auth.ts": "export const a = 1;" },
    });
    expect(plan.skip).toEqual(["src/core/auth/better-auth.ts"]);
    expect(plan.update).toEqual([]);
  });

  it("deletes a local src/core/ file that is no longer in the template", () => {
    const plan = planSyncFromTemplate({
      templateCore: {},
      local: { ...defaultLocal(), "src/core/legacy/old.ts": "export {}" },
    });
    expect(plan.delete).toEqual(["src/core/legacy/old.ts"]);
  });

  it("never touches src/modules/ even when the file would be missing in the template", () => {
    const plan = planSyncFromTemplate({
      templateCore: {},
      local: defaultLocal(),
    });
    expect(plan.delete).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
  });

  it("never touches non-core paths even when present in the local tree (e.g. tests/, prisma/)", () => {
    const plan = planSyncFromTemplate({
      templateCore: { "src/core/x.ts": "1" },
      local: {
        "tests/foo.spec.ts": "export {}",
        "prisma/schema.prisma": "datasource db {}",
        "package.json": "{}",
      },
    });
    expect(plan.delete).toEqual([]);
    expect(plan.create).toEqual([{ path: "src/core/x.ts", content: "1" }]);
  });

  it("rejects a template snapshot that contains paths outside src/core/", () => {
    expect(() =>
      planSyncFromTemplate({
        templateCore: { "src/modules/leak.ts": "export {}" },
        local: defaultLocal(),
      }),
    ).toThrow(ProtectedPathTouchedError);
  });

  it("summary returns the count of each operation", () => {
    const plan = planSyncFromTemplate({
      templateCore: {
        "src/core/a.ts": "1", // create
        "src/core/b.ts": "2", // update
        "src/core/c.ts": "3", // skip
      },
      local: {
        ...defaultLocal(),
        "src/core/b.ts": "old",
        "src/core/c.ts": "3",
        "src/core/d.ts": "4", // delete
      },
    });
    expect(plan.summary).toEqual({ create: 1, update: 1, skip: 1, delete: 1 });
  });

  it("mixes create / update / skip / delete in a single planning call", () => {
    const plan = planSyncFromTemplate({
      templateCore: {
        "src/core/a.ts": "new",
        "src/core/b.ts": "changed",
        "src/core/c.ts": "same",
      },
      local: {
        ...defaultLocal(),
        "src/core/b.ts": "old",
        "src/core/c.ts": "same",
        "src/core/d.ts": "gone",
      },
    });
    expect(plan.create.map((c) => c.path)).toEqual(["src/core/a.ts"]);
    expect(plan.update.map((c) => c.path)).toEqual(["src/core/b.ts"]);
    expect(plan.skip).toEqual(["src/core/c.ts"]);
    expect(plan.delete).toEqual(["src/core/d.ts"]);
  });

  it("produces deterministic output (alphabetical path order per bucket)", () => {
    const plan = planSyncFromTemplate({
      templateCore: {
        "src/core/z.ts": "1",
        "src/core/a.ts": "1",
        "src/core/m.ts": "1",
      },
      local: defaultLocal(),
    });
    expect(plan.create.map((c) => c.path)).toEqual([
      "src/core/a.ts",
      "src/core/m.ts",
      "src/core/z.ts",
    ]);
  });
});
