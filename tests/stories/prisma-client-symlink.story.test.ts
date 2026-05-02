import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  planPrismaClientSymlink,
  type PrismaClientSymlinkLayout,
} from "../../src/core/setup/prisma-client-symlink.js";
import {
  ensurePrismaClientSymlink,
  inspectPrismaClientLayout,
} from "../../src/core/setup/prisma-client-symlink-runner.js";

/**
 * Story · Prisma-Client symlink.
 *
 * The fix for the pnpm-hoisting blocker (see planner header). The
 * planner is pure and deterministic; the runner does the I/O. Tests
 * cover both halves so regressions on either side fail loud.
 */
describe("Story · Prisma-Client symlink planner", () => {
  function layout(overrides: Partial<PrismaClientSymlinkLayout> = {}): PrismaClientSymlinkLayout {
    return {
      packagePrismaClientDefaultExists: true,
      parentNodeModulesDir: "/ws/node_modules",
      parentPrismaEntry: null,
      parentPrismaClientDefaultExists: false,
      ...overrides,
    };
  }

  it("returns noop when the generator output does not exist yet", () => {
    const plan = planPrismaClientSymlink({
      packageRoot: "/ws/projects/api",
      layout: layout({ packagePrismaClientDefaultExists: false }),
    });
    expect(plan).toEqual({ kind: "noop", reason: "package-output-missing" });
  });

  it("returns noop in a single-package checkout (no parent node_modules)", () => {
    const plan = planPrismaClientSymlink({
      packageRoot: "/lone-project",
      layout: layout({ parentNodeModulesDir: null }),
    });
    expect(plan).toEqual({ kind: "noop", reason: "no-parent-node-modules" });
  });

  it("returns noop when the parent already resolves .prisma/client/default", () => {
    const plan = planPrismaClientSymlink({
      packageRoot: "/ws/projects/api",
      layout: layout({ parentPrismaClientDefaultExists: true }),
    });
    expect(plan).toEqual({ kind: "noop", reason: "parent-already-resolves" });
  });

  it("plans a create when the parent has no .prisma entry yet", () => {
    const plan = planPrismaClientSymlink({
      packageRoot: "/ws/projects/api",
      layout: layout(),
    });
    expect(plan).toEqual({
      kind: "create",
      source: "/ws/projects/api/node_modules/.prisma",
      target: "/ws/node_modules/.prisma",
    });
  });

  it("plans a replace when the parent's .prisma entry is a stale symlink", () => {
    const plan = planPrismaClientSymlink({
      packageRoot: "/ws/projects/api",
      layout: layout({ parentPrismaEntry: { isSymlink: true } }),
    });
    expect(plan).toEqual({
      kind: "replace",
      source: "/ws/projects/api/node_modules/.prisma",
      target: "/ws/node_modules/.prisma",
    });
  });

  it("refuses to clobber a real .prisma directory at the parent — surfaces error", () => {
    const plan = planPrismaClientSymlink({
      packageRoot: "/ws/projects/api",
      layout: layout({ parentPrismaEntry: { isSymlink: false } }),
    });
    expect(plan).toEqual({
      kind: "error",
      reason: "parent-prisma-is-real-directory",
      target: "/ws/node_modules/.prisma",
    });
  });
});

describe("Story · Prisma-Client symlink runner I/O", () => {
  let workspace: string;
  let logs: string[];
  const logger = {
    info: (msg: string) => logs.push(`INFO ${msg}`),
    warn: (msg: string) => logs.push(`WARN ${msg}`),
    error: (msg: string) => logs.push(`ERROR ${msg}`),
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), "prisma-symlink-"));
    logs = [];
  });
  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  /**
   * Build a fake pnpm-hoisted layout:
   *   <ws>/
   *     node_modules/                ← workspace-root, where the symlink lands
   *     projects/api/
   *       node_modules/.prisma/client/default.js  ← generator output
   */
  function setupHoistedLayout(): { packageRoot: string } {
    const packageRoot = join(workspace, "projects", "api");
    mkdirSync(join(workspace, "node_modules"), { recursive: true });
    mkdirSync(join(packageRoot, "node_modules", ".prisma", "client"), {
      recursive: true,
    });
    writeFileSync(
      join(packageRoot, "node_modules", ".prisma", "client", "default.js"),
      "module.exports = {};\n",
    );
    return { packageRoot };
  }

  it("inspects a fresh hoisted layout and reports the missing .prisma entry", () => {
    const { packageRoot } = setupHoistedLayout();
    const layout = inspectPrismaClientLayout(packageRoot);
    expect(layout.packagePrismaClientDefaultExists).toBe(true);
    expect(layout.parentNodeModulesDir).toBe(join(workspace, "node_modules"));
    expect(layout.parentPrismaEntry).toBeNull();
    expect(layout.parentPrismaClientDefaultExists).toBe(false);
  });

  it("creates the symlink and afterwards .prisma/client/default resolves at the parent", () => {
    const { packageRoot } = setupHoistedLayout();
    const result = ensurePrismaClientSymlink({ packageRoot, logger });
    expect(result.kind).toBe("create");

    // Re-inspect: the parent now has a symlink that resolves the
    // generator's default.js — exactly the condition `@prisma/client`
    // needs at runtime.
    const after = inspectPrismaClientLayout(packageRoot);
    expect(after.parentPrismaEntry).toEqual({ isSymlink: true });
    expect(after.parentPrismaClientDefaultExists).toBe(true);
  });

  it("is idempotent: a second run returns noop with parent-already-resolves", () => {
    const { packageRoot } = setupHoistedLayout();
    ensurePrismaClientSymlink({ packageRoot, logger });
    const second = ensurePrismaClientSymlink({ packageRoot, logger });
    expect(second.kind).toBe("noop");
    if (second.kind === "noop") {
      expect(second.reason).toBe("parent-already-resolves");
    }
  });

  it("replaces a stale symlink that pointed at a now-deleted directory", () => {
    const { packageRoot } = setupHoistedLayout();
    // Stage a stale symlink — points at a path that doesn't exist.
    symlinkSync(join(workspace, "non-existent-target"), join(workspace, "node_modules", ".prisma"));
    const result = ensurePrismaClientSymlink({ packageRoot, logger });
    expect(result.kind).toBe("replace");
    const after = inspectPrismaClientLayout(packageRoot);
    expect(after.parentPrismaEntry).toEqual({ isSymlink: true });
    expect(after.parentPrismaClientDefaultExists).toBe(true);
  });

  it("refuses to clobber a real .prisma directory at the parent", () => {
    const { packageRoot } = setupHoistedLayout();
    // A real directory at the target path — we don't know what's in
    // it, so the runner must error out and let the user inspect.
    mkdirSync(join(workspace, "node_modules", ".prisma"), { recursive: true });
    writeFileSync(join(workspace, "node_modules", ".prisma", "marker.txt"), "important user data");
    const result = ensurePrismaClientSymlink({ packageRoot, logger });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.reason).toBe("parent-prisma-is-real-directory");
    }
  });

  it("returns noop in a single-package layout (template self-test)", () => {
    // Just the package — no parent node_modules. The generator
    // output already lives in the only node_modules on the resolution
    // chain, so nothing to do.
    mkdirSync(join(workspace, "node_modules", ".prisma", "client"), {
      recursive: true,
    });
    writeFileSync(
      join(workspace, "node_modules", ".prisma", "client", "default.js"),
      "module.exports = {};\n",
    );
    const result = ensurePrismaClientSymlink({ packageRoot: workspace, logger });
    expect(result.kind).toBe("noop");
    if (result.kind === "noop") {
      expect(result.reason).toBe("no-parent-node-modules");
    }
  });

  it("returns noop when the generator has not produced default.js yet", () => {
    // Hoisted layout but no generator output — postinstall ran
    // before `prisma generate`. We must not create a dangling symlink.
    const packageRoot = join(workspace, "projects", "api");
    mkdirSync(join(workspace, "node_modules"), { recursive: true });
    mkdirSync(join(packageRoot, "node_modules"), { recursive: true });
    const result = ensurePrismaClientSymlink({ packageRoot, logger });
    expect(result.kind).toBe("noop");
    if (result.kind === "noop") {
      expect(result.reason).toBe("package-output-missing");
    }
  });
});
