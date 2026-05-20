import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Dev runner — stale portless registration is taken over.
 *
 * The behaviour lives in `scripts/dev.ts` (boot path; not unit-testable
 * without a real spawn). These structural assertions guard the
 * contract: the runner imports the planner, reads the routes file,
 * and adds `--force` to the `portless run` argv when the planner
 * returns "take-over". The actual stale-recovery is exercised manually
 * (kill -9 a `bun --watch`, then `bun run dev` and observe no error).
 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const DEV_SCRIPT = readFileSync(resolve(REPO_ROOT, "scripts/dev.ts"), "utf8");

describe("Story · Dev runner — stale portless registration takeover", () => {
  it("imports the registration-decision planner from src/core/dev/portless.js", () => {
    expect(DEV_SCRIPT).toMatch(/decideRegistrationAction/);
  });

  it("ensures the portless proxy is running before portless run", () => {
    expect(DEV_SCRIPT).toMatch(/ensurePortlessProxyRunning/);
  });

  it("imports a routes-reading helper to look up the existing PID", () => {
    // The runner needs to read ~/.portless/routes.json; that's the
    // only way to know whether to pass --force without provoking the
    // RouteConflictError first.
    expect(DEV_SCRIPT).toMatch(/readPortlessRouteOwner|loadPortlessRoutes/);
  });

  it("threads the planner's decision into buildPortlessRunCommand via `force:`", () => {
    // Look for `force: decision === 'take-over'` (or any form that
    // forwards the planner's output as the `force` argument). The
    // emit-of-`--force` itself lives in the planner's
    // buildPortlessRunCommand and is exercised by its own unit test.
    expect(DEV_SCRIPT).toMatch(/force\s*:\s*decision\s*===\s*['"]take-over['"]/);
  });

  it("logs a stale-takeover hint so the dev knows portless evicted a dead PID", () => {
    // The user-visible message should mention the stale PID so the
    // takeover isn't completely silent. Wording is flexible — the
    // "stale" + "portless" tokens are the load-bearing ones.
    expect(DEV_SCRIPT).toMatch(/stale.*portless|portless.*stale/i);
  });
});
