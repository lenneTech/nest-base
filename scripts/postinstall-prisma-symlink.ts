#!/usr/bin/env bun
/**
 * `bun run postinstall` — resolves the pnpm-hoisting blocker that
 * surfaces in workspaces created by `lt fullstack init --next`.
 *
 * Background: Prisma 7's `@prisma/client/default.js` does
 * `require('.prisma/client/default')`. Node walks `node_modules/`
 * directories upwards from the `@prisma/client` package looking for
 * a `.prisma/client/default.js` to resolve. The Prisma generator
 * writes that file under the *consuming package's* `node_modules/
 * .prisma/client/`. In a single-package checkout that's the same
 * location Node looks; in a pnpm workspace `@prisma/client` lives
 * at the workspace root, and the upward walk never reaches the
 * package-local generator output. Result: `Cannot find module
 * '.prisma/client/default'` at boot.
 *
 * Fix: ensure the workspace-root `node_modules/` has a `.prisma`
 * symlink pointing at the package-local generator output. Idempotent
 * (no-op if the parent already resolves), safe (refuses to clobber
 * a real directory), self-locating (uses `process.cwd()` so the
 * script is portable across `projects/api/`, `packages/api/`, or
 * any other monorepo layout).
 *
 * Pure logic lives in `src/core/setup/prisma-client-symlink.ts` +
 * `…/prisma-client-symlink-runner.ts`. This file is the thin CLI
 * surface (cwd + stdout logging + exit code).
 */

import { ensurePrismaClientSymlink } from "../src/core/setup/prisma-client-symlink-runner.js";

const result = ensurePrismaClientSymlink({
  packageRoot: process.cwd(),
  logger: {
    info: (msg) => console.log(`[postinstall] ${msg}`),
    warn: (msg) => console.warn(`[postinstall] ${msg}`),
    error: (msg) => console.error(`[postinstall] ${msg}`),
  },
});

// `error` plans surface as a non-zero exit code so installs fail
// loud rather than silently leave the workspace broken. Every other
// outcome (noop, create, replace) is success.
if (result.kind === "error") {
  process.exit(1);
}
