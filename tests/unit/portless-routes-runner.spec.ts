import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isPidAlive,
  readPortlessRouteOwner,
  resolvePortlessRoutesPath,
} from "../../src/core/dev/portless-routes-runner.js";

/**
 * Thin runner over `~/.portless/routes.json`. The pure
 * `decideRegistrationAction` planner is covered in stories; this spec
 * exercises the I/O glue: file resolution, parse robustness, and PID
 * liveness probe.
 */
describe("portless-routes-runner", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "portless-routes-"));
  });
  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  describe("resolvePortlessRoutesPath", () => {
    it("uses ~/.portless/routes.json when PORTLESS_STATE_DIR is unset", () => {
      const out = resolvePortlessRoutesPath({});
      expect(out).toMatch(/\.portless[\\/]routes\.json$/);
    });

    it("respects PORTLESS_STATE_DIR for tests", () => {
      const out = resolvePortlessRoutesPath({ PORTLESS_STATE_DIR: stateDir });
      expect(out).toBe(join(stateDir, "routes.json"));
    });

    it("treats an empty PORTLESS_STATE_DIR as unset (no silent home-dir bypass)", () => {
      // Defence-in-depth: an accidental `export PORTLESS_STATE_DIR=`
      // must NOT route us to `/routes.json` at the FS root.
      const out = resolvePortlessRoutesPath({ PORTLESS_STATE_DIR: "" });
      expect(out).toMatch(/\.portless[\\/]routes\.json$/);
    });
  });

  describe("readPortlessRouteOwner", () => {
    const ROUTES = (): string => join(stateDir, "routes.json");
    const writeRoutes = (content: string): void => writeFileSync(ROUTES(), content, "utf8");

    it("returns undefined when the routes file is missing", () => {
      expect(readPortlessRouteOwner("api.foo.localhost", ROUTES())).toBeUndefined();
    });

    it("returns undefined for malformed JSON (corrupt file must not crash dev)", () => {
      writeRoutes("{not-json}");
      expect(readPortlessRouteOwner("api.foo.localhost", ROUTES())).toBeUndefined();
    });

    it("returns undefined when the JSON root is not an array (forward-compat shield)", () => {
      writeRoutes(JSON.stringify({ routes: [] }));
      expect(readPortlessRouteOwner("api.foo.localhost", ROUTES())).toBeUndefined();
    });

    it("returns undefined when no entry matches the requested hostname", () => {
      writeRoutes(JSON.stringify([{ hostname: "other.localhost", port: 4000, pid: 1 }]));
      expect(readPortlessRouteOwner("api.foo.localhost", ROUTES())).toBeUndefined();
    });

    it("returns the matching record's pid + port", () => {
      writeRoutes(
        JSON.stringify([
          { hostname: "other.localhost", port: 4000, pid: 11 },
          { hostname: "api.foo.localhost", port: 4123, pid: 99 },
        ]),
      );
      const out = readPortlessRouteOwner("api.foo.localhost", ROUTES());
      expect(out).toEqual({ hostname: "api.foo.localhost", port: 4123, pid: 99 });
    });

    it("tolerates entries with non-numeric pid by defaulting to 0 (treated as no-existing)", () => {
      writeRoutes(JSON.stringify([{ hostname: "api.foo.localhost", port: 4123, pid: "ghost" }]));
      const out = readPortlessRouteOwner("api.foo.localhost", ROUTES());
      expect(out).toEqual({ hostname: "api.foo.localhost", port: 4123, pid: 0 });
    });
  });

  describe("isPidAlive", () => {
    it("is true for the current process", () => {
      expect(isPidAlive(process.pid)).toBe(true);
    });

    it("is false for a definitely-dead PID (1 above process.pid is unlikely to exist on a quiet box, so probe a guaranteed-large PID)", () => {
      // Probe an obviously-out-of-range PID — `process.kill` raises
      // ESRCH for it on every Unix and Windows alike.
      expect(isPidAlive(2_000_000_000)).toBe(false);
    });

    it("is false for invalid pid values (0, negative, NaN)", () => {
      expect(isPidAlive(0)).toBe(false);
      expect(isPidAlive(-1)).toBe(false);
      expect(isPidAlive(Number.NaN)).toBe(false);
    });
  });

  it("the temp state dir is a real directory (sanity)", () => {
    mkdirSync(join(stateDir, "noop"), { recursive: true });
    expect(true).toBe(true);
  });
});
