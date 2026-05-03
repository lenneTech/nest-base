/**
 * Pure planner for the test-runner's "ensure Prisma client is generated"
 * step.
 *
 * The friction this closes
 * ------------------------
 * A pristine `lt fullstack init --next` workspace walks through:
 *
 *   bun install                    ← postinstall: pnpm-hoisting symlink only
 *   bun run setup                  ← writes .env, picks free port
 *   docker compose up -d postgres
 *   bun run prepare:schema         ← regenerates schema.prisma from features
 *   bun run prisma:migrate         ← `prisma migrate deploy` (does NOT generate)
 *   bun run test:e2e <spec>        ← boom: "Cannot find module '.prisma/client/default'"
 *
 * `@prisma/client/default.js` does `require('.prisma/client/default')`,
 * which resolves to `<package>/node_modules/.prisma/client/default.js`
 * — a file written only by `prisma generate`. None of the documented
 * setup steps run it. The first test invocation surfaces the gap with
 * an opaque module-resolution error long before any test assertion has
 * a chance to run, so the LLM-test agent's friction-log entry recorded
 * "55 e2e tests fail" without naming the underlying cause.
 *
 * The fix has two layers:
 *
 *   1. The pure planner here (testable, deterministic) decides whether
 *      `prisma generate` needs to run on this invocation.
 *   2. The runner in `tests/global-setup.ts` executes the plan via
 *      `bunx prisma generate` before any worker forks, so the workers
 *      that import `@prisma/client` see a populated `.prisma/client/`
 *      directory.
 *
 * Why testcontainers don't already cover this: the tests boot a fresh
 * Postgres testcontainer for every run, but they reuse the package's
 * generated Prisma client. On a repo where someone has run
 * `prisma generate` once (the maintainer's machine, CI's cached
 * `node_modules/`), the missing-client failure is invisible. The
 * planner makes the decision visible and self-healing.
 *
 * Idempotent
 * ----------
 * The planner returns `skip` when the client is already on disk. A
 * `bun run test:e2e` after the first one pays no cost. The runner is
 * additionally safe against partial outputs because
 * `default.js`-existence is the resolution check Node itself performs.
 */

export interface PrismaClientCheckLayout {
  /**
   * Absolute path of the package whose Prisma client should be
   * generated. The runner stat-checks the schema + client files
   * relative to this directory and runs the generator from here.
   */
  packageRoot: string;

  /**
   * Whether `<packageRoot>/node_modules/.prisma/client/default.js`
   * exists. This is the exact file Node attempts to resolve when
   * `@prisma/client/default.js` requires `.prisma/client/default`.
   * If it's there, generation is unnecessary.
   */
  packagePrismaClientDefaultExists: boolean;

  /**
   * Whether `<packageRoot>/prisma/schema.prisma` exists. `prisma
   * generate` reads from this file, so without it the runner has
   * nothing to generate from. Skip the spawn rather than crash the
   * test runner with an opaque "schema not found" inside the
   * generator subprocess.
   */
  schemaExists: boolean;
}

export type EnsurePrismaClientPlan =
  | {
      readonly kind: "skip";
      readonly reason: "client-already-exists" | "no-schema";
    }
  | {
      readonly kind: "generate";
      readonly command: string;
      readonly args: readonly string[];
      readonly cwd: string;
    };

/**
 * Pure: derive whether `prisma generate` should run from a filesystem
 * snapshot.
 */
export function planEnsurePrismaClient(layout: PrismaClientCheckLayout): EnsurePrismaClientPlan {
  // Defensive ordering: schema-missing wins over client-missing.
  // Without a schema the generator subprocess would fail loudly; we'd
  // rather skip and let the user surface their non-standard layout
  // when they actually need the client.
  if (!layout.schemaExists) {
    return { kind: "skip", reason: "no-schema" };
  }
  if (layout.packagePrismaClientDefaultExists) {
    return { kind: "skip", reason: "client-already-exists" };
  }
  // `bunx` resolves `prisma` from the package's own node_modules so
  // we don't depend on a globally-installed `prisma` CLI. The cwd
  // pin is load-bearing — the generator reads `prisma/schema.prisma`
  // relative to it.
  return {
    kind: "generate",
    command: "bunx",
    args: ["prisma", "generate"],
    cwd: layout.packageRoot,
  };
}
