/**
 * Prisma-Client-Symlink planner.
 *
 * Why this module exists
 * -----------------------
 * Prisma 7's `@prisma/client/default.js` is a forwarding shim:
 *
 *   module.exports = { ...require('.prisma/client/default') }
 *
 * That bare specifier (`.prisma/client/default`) leans on Node's
 * upward `node_modules/` resolution. The Prisma generator writes its
 * output to `<schema-dir>/../node_modules/.prisma/client/` — i.e. into
 * the **local** package's `node_modules/.prisma/`. In a single-package
 * checkout that's also the same directory `@prisma/client` is loaded
 * from, so the upward walk finds the generated default.js on the
 * first hop and everything resolves.
 *
 * In a pnpm workspace (`lt fullstack init --next` scaffolds one), the
 * picture is different:
 *
 *   workspace-root/
 *     node_modules/                         ← `@prisma/client` is hoisted here
 *       @prisma/client/default.js           ← does require('.prisma/client/default')
 *     projects/api/
 *       node_modules/.prisma/client/        ← generator writes here
 *       prisma/schema.prisma
 *
 * Node resolves `require('.prisma/client/default')` starting from the
 * parent dir of the `@prisma/client` package — i.e. workspace-root's
 * `node_modules/`. That dir has no `.prisma/`, so resolution fails
 * with `Cannot find module '.prisma/client/default'` and `bun run dev`
 * crashes at boot. Tests pass because vitest resolves modules from
 * `projects/api/`, hiding the issue from CI.
 *
 * The fix
 * --------
 * After every `bun install`, ensure the workspace-root `node_modules/`
 * has a `.prisma` entry that points at the generator's actual output
 * directory. A symlink is the simplest hammer: it costs no disk, no
 * second `prisma generate` run, and lets the upward resolution chain
 * succeed in both layouts.
 *
 * This file is the **pure planner**: it takes a snapshot of the
 * filesystem layout (what exists, what doesn't) and returns the
 * single concrete action to take — `noop`, `create`, or `replace`
 * — with the exact source/target paths. The runner does the I/O.
 *
 * Idempotency
 * -----------
 * The planner returns `noop` if:
 *   - the package is not nested under a parent `node_modules/`
 *     (single-package layout — the generator's output is already in
 *     the only `node_modules/` on the resolution path)
 *   - the parent already has a `.prisma/client/default.js` reachable
 *     via the existing symlink or directory (a previous run, or pnpm
 *     itself hoisted it for some reason)
 *
 * Safety
 * ------
 * The planner refuses to clobber a real directory at the parent
 * `.prisma` path. Replacement is only allowed when the existing entry
 * is itself a symlink (= our own previous run, or an obviously
 * disposable artefact). Real directories at that path indicate
 * something we don't understand — abort with `error` so the user can
 * inspect manually.
 */

export interface PrismaClientSymlinkInputs {
  /**
   * Absolute path of the package whose `prisma/schema.prisma` was
   * just generated. Typically `process.cwd()` from the postinstall
   * script.
   */
  packageRoot: string;

  /**
   * Filesystem snapshot — `runner` produces this by stat-ing the
   * candidate paths. Keeping it in the input keeps the planner pure
   * (no `fs` import).
   */
  layout: PrismaClientSymlinkLayout;
}

export interface PrismaClientSymlinkLayout {
  /**
   * Whether `<packageRoot>/node_modules/.prisma/client/default.js`
   * exists. If it doesn't, the generator hasn't run yet and the
   * symlink would point at nothing — we bail out with `noop` so the
   * caller can re-run after `prisma generate`.
   */
  packagePrismaClientDefaultExists: boolean;

  /**
   * Absolute path of the ancestor `node_modules/` directory that
   * houses `@prisma/client` (the location whose upward resolution
   * needs `.prisma/client/default` to be findable). `null` in a
   * single-package checkout where the package's own `node_modules/`
   * is the only one on the resolution chain — nothing to do there.
   */
  parentNodeModulesDir: string | null;

  /**
   * Whether the parent's `node_modules/.prisma` entry exists at all,
   * and if so whether it is a symlink. `null` when the entry does not
   * exist.
   */
  parentPrismaEntry: { isSymlink: boolean } | null;

  /**
   * Whether the parent's `node_modules/.prisma/client/default.js`
   * already resolves successfully (= some other tool already wired it
   * up, or pnpm hoisted the generator output on its own).
   */
  parentPrismaClientDefaultExists: boolean;
}

export type PrismaClientSymlinkPlan =
  | {
      readonly kind: "noop";
      readonly reason:
        | "no-parent-node-modules"
        | "package-output-missing"
        | "parent-already-resolves";
    }
  | {
      readonly kind: "create";
      readonly source: string;
      readonly target: string;
    }
  | {
      readonly kind: "replace";
      readonly source: string;
      readonly target: string;
    }
  | {
      readonly kind: "error";
      readonly reason: "parent-prisma-is-real-directory";
      readonly target: string;
    };

const NODE_MODULES = "node_modules";
const PRISMA_DIR = ".prisma";

/**
 * Pure: derive the action to take from a filesystem snapshot. The
 * caller is responsible for stat-ing paths into the `layout` shape;
 * this function never touches I/O.
 */
export function planPrismaClientSymlink(
  inputs: PrismaClientSymlinkInputs,
): PrismaClientSymlinkPlan {
  const { packageRoot, layout } = inputs;

  if (!layout.packagePrismaClientDefaultExists) {
    return { kind: "noop", reason: "package-output-missing" };
  }

  if (layout.parentNodeModulesDir === null) {
    return { kind: "noop", reason: "no-parent-node-modules" };
  }

  if (layout.parentPrismaClientDefaultExists) {
    return { kind: "noop", reason: "parent-already-resolves" };
  }

  const source = joinPath(packageRoot, NODE_MODULES, PRISMA_DIR);
  const target = joinPath(layout.parentNodeModulesDir, PRISMA_DIR);

  if (layout.parentPrismaEntry === null) {
    return { kind: "create", source, target };
  }

  // An existing symlink we'll replace (e.g. a stale link from a
  // previous workspace, or pnpm hoisted but pointed elsewhere).
  if (layout.parentPrismaEntry.isSymlink) {
    return { kind: "replace", source, target };
  }

  // A real directory at the target path is the dangerous case — we
  // don't know what's in it, so the runner must surface an error
  // rather than silently `rm -rf` user data.
  return {
    kind: "error",
    reason: "parent-prisma-is-real-directory",
    target,
  };
}

/**
 * Cross-platform path join that uses POSIX separators on every
 * platform but preserves the package root as the caller passed it.
 * Exposed for testability — the runner uses node:path.resolve, this
 * keeps the planner deterministic without pulling node:path in.
 */
function joinPath(...parts: string[]): string {
  if (parts.length === 0) return "";
  const head = parts[0]!;
  const tail = parts.slice(1).filter((p) => p.length > 0);
  if (tail.length === 0) return head;
  // Detect OS-style separator from the first segment (Windows: `\`,
  // POSIX: `/`). Falling back to `/` is fine because Node accepts
  // forward slashes on Windows too.
  const sep = head.includes("\\") && !head.includes("/") ? "\\" : "/";
  const trimmed = head.endsWith(sep) ? head.slice(0, -1) : head;
  return [trimmed, ...tail].join(sep);
}
