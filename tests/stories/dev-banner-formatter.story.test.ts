import { describe, expect, it } from "vitest";

import {
  formatDevReadyLine,
  formatDevSurvivalBanner,
  formatPortCollisionMessage,
} from "../../src/core/dev/dev-banner-formatter.js";

/**
 * Story · Dev-Runner — survival banner formatter.
 *
 * Friction 2026-05-03 #14:36 (HIGH): `bun run dev` stops mid route-mapping
 * after `ExampleController …` and never prints any "listening on" line.
 * Background task ultimately reports exit code 144. From a fresh agent's
 * perspective there is no way to know which port the API took.
 *
 * The fix is a pure formatter that produces a one-line survival banner
 * the runner emits *before* any NestJS lifecycle hook can crash — and a
 * post-listen ready line so the user always sees the resolved URL.
 *
 * The formatter is pure (string-in, string-out) so it stays trivially
 * testable. The runner emits the lines via `process.stdout.write` so a
 * downstream EPIPE / SIGPIPE / buffering crash cannot swallow them.
 */
describe("Story · Dev-Runner survival banner formatter", () => {
  describe("formatDevSurvivalBanner", () => {
    it("renders the canonical [dev] API listening on <url> line for http", () => {
      const line = formatDevSurvivalBanner({
        scheme: "http",
        host: "localhost",
        port: 3000,
      });
      expect(line).toBe("[dev] API listening on http://localhost:3000\n");
    });

    it("renders an https URL when portless is active (no explicit port)", () => {
      // Portless terminates TLS on :443 and routes by hostname; the
      // banner should not glue ":443" onto the URL.
      const line = formatDevSurvivalBanner({
        scheme: "https",
        host: "api.my-app.localhost",
        port: 443,
      });
      expect(line).toBe("[dev] API listening on https://api.my-app.localhost\n");
    });

    it("includes a non-default port for https (e.g. tunnel previews)", () => {
      const line = formatDevSurvivalBanner({
        scheme: "https",
        host: "preview.localhost",
        port: 8443,
      });
      expect(line).toBe("[dev] API listening on https://preview.localhost:8443\n");
    });

    it("trims trailing whitespace in host but keeps the trailing newline", () => {
      // Defensive against env-derived hosts with stray whitespace.
      const line = formatDevSurvivalBanner({
        scheme: "http",
        host: "  localhost  ",
        port: 3000,
      });
      expect(line).toBe("[dev] API listening on http://localhost:3000\n");
    });
  });

  describe("formatDevReadyLine", () => {
    it("renders [dev] Ready in <ms>ms — open <url> with the resolved URL", () => {
      const line = formatDevReadyLine({
        scheme: "http",
        host: "localhost",
        port: 3000,
        elapsedMs: 1234,
      });
      // Use a plain ASCII em-dash separator for terminal-fidelity: tests
      // that grep `[dev]` in CI logs must match without UTF-8 surprises.
      expect(line).toBe("[dev] Ready in 1234ms — open http://localhost:3000\n");
    });

    it("rounds fractional elapsed milliseconds to the nearest integer", () => {
      const line = formatDevReadyLine({
        scheme: "http",
        host: "localhost",
        port: 3000,
        elapsedMs: 42.7,
      });
      expect(line).toContain("Ready in 43ms");
    });
  });

  describe("formatPortCollisionMessage", () => {
    it("explains the collision and lists the three escape hatches", () => {
      const msg = formatPortCollisionMessage({
        port: 3000,
        holderHint: "foreign process (responded with 426 Upgrade Required)",
      });
      // Shape: heading + holder hint + 3 numbered options.
      expect(msg).toContain("[dev] port 3000 is already in use");
      expect(msg).toContain("foreign process (responded with 426 Upgrade Required)");
      expect(msg).toMatch(/lsof -i :3000/);
      expect(msg).toMatch(/PORT=/);
      expect(msg).toMatch(/DISABLE_PORTLESS=1/);
    });
  });
});
