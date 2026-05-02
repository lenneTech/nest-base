/**
 * Prisma-Client-Symlink runner.
 *
 * Thin I/O shim around `planPrismaClientSymlink`:
 *   - `inspectPrismaClientLayout(packageRoot)` stat-checks the four
 *     paths the planner needs and produces the snapshot input.
 *   - `ensurePrismaClientSymlink({ packageRoot, logger })` runs the
 *     planner, executes the resulting action with `node:fs` calls,
 *     and returns the plan that was applied (so callers can log /
 *     report).
 *
 * The split keeps the planner pure (testable without `fs`) and the
 * runner small enough to read in one screen.
 *
 * Failure mode: a real-directory clobber returns the planner's
 * `error` plan unchanged. The script wrapper turns that into a
 * non-zero exit code with a clear hint; programmatic callers can
 * inspect `result.kind === 'error'` and decide.
 */

import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  planPrismaClientSymlink,
  type PrismaClientSymlinkLayout,
  type PrismaClientSymlinkPlan,
} from "./prisma-client-symlink.js";

export interface PrismaClientSymlinkLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

export interface EnsurePrismaClientSymlinkOptions {
  /**
   * Absolute path to the package whose Prisma client was generated.
   * Defaults to `process.cwd()` for the script wrapper; tests pass
   * a tmpdir.
   */
  packageRoot: string;
  logger: PrismaClientSymlinkLogger;
}

/**
 * Stat-check the paths the planner needs and produce a layout
 * snapshot.
 *
 * `parentNodeModulesDir`: walk parents of `packageRoot` upwards
 * looking for an ancestor `node_modules/` directory. The first
 * ancestor `node_modules/` we hit (different from the package's
 * own) is the one Node will consult during the upward
 * `.prisma/client/default` lookup — that's where the symlink
 * belongs. We stop at `/` (or the platform root) without finding
 * one in a single-package checkout, where this returns `null` and
 * the planner short-circuits to noop.
 *
 * Why we don't filesystem-resolve `@prisma/client` itself: the
 * package may legitimately live in a hoisted location distant from
 * the resolution-chain target (pnpm's `.pnpm/` virtual store). The
 * symlink target Node needs is the FIRST ancestor `node_modules/`
 * above the package root, regardless of where `@prisma/client`
 * physically sits. Both Bun and Node walk the directory chain
 * symmetrically.
 */
export function inspectPrismaClientLayout(packageRoot: string): PrismaClientSymlinkLayout {
  const packagePrismaClientDefault = resolve(
    packageRoot,
    "node_modules",
    ".prisma",
    "client",
    "default.js",
  );

  const parentNodeModules = findAncestorNodeModules(packageRoot);
  const parentPrismaPath = parentNodeModules ? resolve(parentNodeModules, ".prisma") : null;
  const parentPrismaClientDefault = parentPrismaPath
    ? resolve(parentPrismaPath, "client", "default.js")
    : null;

  let parentPrismaEntry: { isSymlink: boolean } | null = null;
  if (parentPrismaPath) {
    try {
      const stat = lstatSync(parentPrismaPath);
      parentPrismaEntry = { isSymlink: stat.isSymbolicLink() };
    } catch {
      parentPrismaEntry = null;
    }
  }

  return {
    packagePrismaClientDefaultExists: existsSync(packagePrismaClientDefault),
    parentNodeModulesDir: parentNodeModules,
    parentPrismaEntry,
    // existsSync follows symlinks — exactly the runtime check we want
    // (would `@prisma/client/default.js` find a default.js via the
    // upward walk?).
    parentPrismaClientDefaultExists: parentPrismaClientDefault
      ? existsSync(parentPrismaClientDefault)
      : false,
  };
}

/**
 * Walk parents of `start` upward and return the first ancestor's
 * `node_modules/` directory. Returns `null` when no ancestor has
 * one (single-package checkout). The package's own `node_modules/`
 * is intentionally excluded — the symlink only matters in
 * directories *above* the package root.
 */
function findAncestorNodeModules(start: string): string | null {
  let current = dirname(start);
  while (current && current !== dirname(current)) {
    const candidate = resolve(current, "node_modules");
    if (existsSync(candidate)) return candidate;
    current = dirname(current);
  }
  return null;
}

export function ensurePrismaClientSymlink(
  options: EnsurePrismaClientSymlinkOptions,
): PrismaClientSymlinkPlan {
  const { packageRoot, logger } = options;
  const layout = inspectPrismaClientLayout(packageRoot);
  const plan = planPrismaClientSymlink({ packageRoot, layout });

  switch (plan.kind) {
    case "noop":
      logger.info(`Prisma client symlink: ${describeNoop(plan.reason)}`);
      return plan;

    case "create":
      // Ensure the parent exists — happens when a user manually
      // wiped node_modules at the workspace root.
      mkdirSync(dirname(plan.target), { recursive: true });
      try {
        // `dir` hint for portability: works on Windows and POSIX.
        symlinkSync(plan.source, plan.target, "dir");
        logger.info(`Prisma client symlink: created ${plan.target} → ${plan.source}`);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // EEXIST means a concurrent install raced us — treat as
        // success because the next `inspectPrismaClientLayout`
        // would have returned `parent-already-resolves` anyway.
        if (code !== "EEXIST") {
          logger.error(
            `Prisma client symlink: failed to create ${plan.target} → ${plan.source}: ${(err as Error).message}`,
          );
          throw err;
        }
      }
      return plan;

    case "replace":
      try {
        // Stale symlink — safe to unlink because the planner only
        // returns `replace` when the existing entry is itself a
        // symlink (real directories surface as `error`).
        rmSync(plan.target, { recursive: false, force: true });
        symlinkSync(plan.source, plan.target, "dir");
        logger.info(
          `Prisma client symlink: replaced stale link at ${plan.target} → ${plan.source}`,
        );
      } catch (err) {
        logger.error(
          `Prisma client symlink: failed to replace ${plan.target}: ${(err as Error).message}`,
        );
        throw err;
      }
      return plan;

    case "error":
      logger.error(
        `Prisma client symlink: refusing to clobber real directory at ${plan.target}. ` +
          `Inspect contents and remove manually if it is a stale Prisma artefact, ` +
          `then re-run the postinstall script.`,
      );
      return plan;
  }
}

function describeNoop(
  reason: Extract<PrismaClientSymlinkPlan, { kind: "noop" }>["reason"],
): string {
  switch (reason) {
    case "no-parent-node-modules":
      return "single-package layout, nothing to do";
    case "package-output-missing":
      return "skipped (run `bun run prisma:generate` first)";
    case "parent-already-resolves":
      return "already resolves at workspace root, nothing to do";
  }
}
