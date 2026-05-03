/**
 * Vitest `setupFiles` entry: pins NODE_ENV='test' BEFORE any user
 * test code (or imported source) loads in a worker.
 *
 * Why a per-worker setupFile + globalSetup duo:
 *
 *   - globalSetup runs once in the main Vitest process. It can mutate
 *     `process.env` for itself, but worker forks under `pool: 'forks'`
 *     don't always observe those mutations in time — workers fork
 *     from the main process, but module evaluation order can still
 *     read `process.env.NODE_ENV` before the inherited mutation
 *     lands. setupFiles run synchronously at the very top of every
 *     worker, which is the earliest hook before any user import.
 *
 *   - Bun auto-loads `.env` at process start. A fresh consumer
 *     workspace ships `.env` with `NODE_ENV=development`. Without
 *     this pin, the unit test `tests/unit/test-infrastructure.spec.ts`
 *     fails its `expect(process.env.NODE_ENV).toBe("test")` assertion
 *     the very first time someone runs `bun run test:unit`.
 *
 * The pin is intentionally also performed in `tests/global-setup.ts`
 * for belt-and-braces — a defence-in-depth pattern aligned with the
 * existing `with-node-env.ts` and `test-ability.ts` discipline.
 */

import { pinTestNodeEnv } from "../../src/core/testing/pin-test-node-env.js";

pinTestNodeEnv(process.env);
