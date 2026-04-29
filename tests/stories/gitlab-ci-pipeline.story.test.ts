import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · GitLab CI pipeline shape (PLAN.md §32 Phase 8 + §28b.8).
 *
 * The pipeline ships four stages: lint → test → audit → build.
 * The template MUST NOT contain a container-build / image-signing
 * / deploy stage; consumer projects produce their own images. The
 * audit pins the load-bearing pieces so a future cleanup can't
 * silently drop them.
 *
 * The test parses the YAML naively (line-based) — pulling in a
 * full YAML parser is overkill for shape assertions and would
 * couple the suite to yet another runtime dep.
 */
describe("Story · GitLab CI pipeline shape", () => {
  function read(): string {
    const p = resolve(ROOT, ".gitlab-ci.yml");
    expect(existsSync(p), ".gitlab-ci.yml must exist").toBe(true);
    return readFileSync(p, "utf8");
  }

  describe("stages", () => {
    it("declares lint → test → audit → build in this order", () => {
      const yaml = read();
      const lintIdx = yaml.indexOf("  - lint");
      const testIdx = yaml.indexOf("  - test");
      const auditIdx = yaml.indexOf("  - audit");
      const buildIdx = yaml.indexOf("  - build");
      expect(lintIdx).toBeGreaterThan(0);
      expect(testIdx).toBeGreaterThan(lintIdx);
      expect(auditIdx).toBeGreaterThan(testIdx);
      expect(buildIdx).toBeGreaterThan(auditIdx);
    });

    it("does not contain a container-build / image-push / deploy stage", () => {
      const yaml = read();
      expect(yaml).not.toMatch(/^\s+- (container|deploy|publish|release|push)/m);
    });
  });

  describe("image + cache", () => {
    it("uses an oven/bun image as the default", () => {
      const yaml = read();
      expect(yaml).toMatch(/image:\s*oven\/bun/);
    });

    it("caches node_modules keyed on bun.lockb", () => {
      const yaml = read();
      expect(yaml).toContain("bun.lockb");
      expect(yaml).toContain("node_modules");
    });

    it("uses --frozen-lockfile in before_script (no drift on CI)", () => {
      const yaml = read();
      expect(yaml).toMatch(/bun install --frozen-lockfile/);
    });
  });

  describe("jobs", () => {
    it("runs `bun run lint` in the lint stage", () => {
      expect(read()).toMatch(/bun run lint/);
    });

    it("runs the four test gates (unit, e2e, types, coverage)", () => {
      const yaml = read();
      expect(yaml).toMatch(/bun run test:unit/);
      expect(yaml).toMatch(/bun run test:e2e/);
      expect(yaml).toMatch(/bun run test:types/);
      expect(yaml).toMatch(/bun run test:coverage/);
    });

    it("runs `bun audit` in the audit stage", () => {
      expect(read()).toMatch(/bun audit/);
    });

    it("runs `bun run build` in the build stage", () => {
      expect(read()).toMatch(/bun run build/);
    });

    it("publishes a junit report from the e2e job (CI surfaces test failures)", () => {
      const yaml = read();
      expect(yaml).toMatch(/junit:\s*reports\/junit\.xml/);
    });
  });

  describe("test database", () => {
    it("uses postgres:18-alpine as the e2e service (matches docker-compose)", () => {
      expect(read()).toMatch(/postgres:18-alpine/);
    });

    it("exposes DATABASE_URL pointing at the postgres service alias", () => {
      const yaml = read();
      expect(yaml).toMatch(/DATABASE_URL:\s*['"]?postgresql:\/\/[^@]+@postgres:5432/);
    });
  });
});
