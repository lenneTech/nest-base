import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";

/**
 * Story · GitHub Actions CI required-check inventory (PRD line 260).
 *
 * The PRD pins eight gates as merge-blocking: lint + format + test:unit +
 * test:e2e + test:types + test:coverage + build + OpenAPI snapshot drift
 * + SDK drift. Iter-153 closed the previously-uncovered last two; this
 * story locks the contract so a future workflow edit can't silently
 * remove them.
 */

interface CiWorkflow {
  jobs: Record<string, { needs?: string[]; steps?: Array<{ name?: string; run?: string }> }>;
}

describe("Story · .github/workflows/ci.yml gates every PRD-pinned check", () => {
  const projectRoot = resolve(import.meta.dirname, "..", "..");
  const workflowPath = resolve(projectRoot, ".github", "workflows", "ci.yml");
  const workflow = parseYaml(readFileSync(workflowPath, "utf8")) as CiWorkflow;

  it("declares the eight required jobs", () => {
    expect(Object.keys(workflow.jobs)).toEqual(
      expect.arrayContaining([
        "lint",
        "format",
        "test-types",
        "test-unit",
        "test-e2e",
        "test-coverage",
        "build",
        "openapi-snapshot-drift",
        "sdk-drift",
      ]),
    );
  });

  it("the aggregator (ci-success) depends on every required job", () => {
    const needs = workflow.jobs["ci-success"]?.needs ?? [];
    for (const required of [
      "lint",
      "format",
      "test-types",
      "test-unit",
      "test-e2e",
      "test-coverage",
      "build",
      "openapi-snapshot-drift",
      "sdk-drift",
    ]) {
      expect(needs, `ci-success.needs must include ${required}`).toContain(required);
    }
  });

  it("openapi-snapshot-drift invokes `bun run dump:openapi --check`", () => {
    const steps = workflow.jobs["openapi-snapshot-drift"]?.steps ?? [];
    const runs = steps.map((s) => s.run ?? "").join("\n");
    expect(runs).toMatch(/bun run dump:openapi\s+--check/);
  });

  it("sdk-drift invokes `bun run sdk:check`", () => {
    const steps = workflow.jobs["sdk-drift"]?.steps ?? [];
    const runs = steps.map((s) => s.run ?? "").join("\n");
    expect(runs).toMatch(/bun run sdk:check/);
  });

  it("audit job stays advisory-only (continue-on-error)", () => {
    const yaml = readFileSync(workflowPath, "utf8");
    expect(yaml).toMatch(/audit:[^]+?continue-on-error: true/);
  });
});

/**
 * Story · `.gitlab-ci.yml` mirrors the same required-check inventory.
 *
 * Consumer projects forked off this template typically deploy from
 * GitLab; the GitHub workflow is the OSS-side mirror. Both surfaces
 * MUST gate the same set of checks so a merge-blocker on one platform
 * is also a merge-blocker on the other. iter-154 wired the missing
 * OpenAPI snapshot drift + SDK drift jobs into `.gitlab-ci.yml`.
 */
describe("Story · .gitlab-ci.yml mirrors the GitHub workflow's required gates", () => {
  const projectRoot = resolve(import.meta.dirname, "..", "..");
  const gitlabPath = resolve(projectRoot, ".gitlab-ci.yml");

  it(".gitlab-ci.yml declares the openapi-snapshot-drift job", () => {
    const yaml = readFileSync(gitlabPath, "utf8");
    expect(yaml).toMatch(/^test:openapi-snapshot-drift:/m);
    expect(yaml).toMatch(/bun run dump:openapi\s+--check/);
  });

  it(".gitlab-ci.yml declares the sdk-drift job", () => {
    const yaml = readFileSync(gitlabPath, "utf8");
    expect(yaml).toMatch(/^test:sdk-drift:/m);
    expect(yaml).toMatch(/bun run sdk:check/);
  });

  it("audit:dependencies stays advisory-only", () => {
    const yaml = readFileSync(gitlabPath, "utf8");
    expect(yaml).toMatch(/audit:dependencies:[^]+?allow_failure: true/);
  });
});

/**
 * Story · `.gitlab-ci.yml.example` exists for downstream consumers
 * (PRD line 259 — "Downstream-consumer parallel: .gitlab-ci.yml.example
 * shipped"). The template repo also runs an active `.gitlab-ci.yml`
 * with the same content so the template itself stays gated. Iter-166
 * locks the byte-equality contract — drift between the two files
 * means consumers grep one and copy stale pipeline jobs.
 */
describe("Story · .gitlab-ci.yml.example matches active .gitlab-ci.yml byte-for-byte", () => {
  const projectRoot = resolve(import.meta.dirname, "..", "..");
  const activePath = resolve(projectRoot, ".gitlab-ci.yml");
  const examplePath = resolve(projectRoot, ".gitlab-ci.yml.example");

  it("both files exist", () => {
    expect(readFileSync(activePath, "utf8").length).toBeGreaterThan(0);
    expect(readFileSync(examplePath, "utf8").length).toBeGreaterThan(0);
  });

  it("byte-identical (same pipeline definition; rename target for consumers)", () => {
    const active = readFileSync(activePath, "utf8");
    const sample = readFileSync(examplePath, "utf8");
    expect(sample).toBe(active);
  });
});

/**
 * Story · `geoip:download` script exists (PRD line 109 — "Offline
 * GeoIP (.mmdb, dbip-lite default)"). The runtime refresh path
 * (`src/core/geoip/download-runner.ts` + `GeoIpRefreshCron`) was
 * already wired; iter-166 wires the manual one-shot CLI script via
 * `package.json` so `bun run geoip:download` works.
 */
describe("Story · package.json wires geoip:download", () => {
  it("package.json declares `geoip:download`", () => {
    const projectRoot = resolve(import.meta.dirname, "..", "..");
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["geoip:download"]).toBe("bun run scripts/download-geoip.ts");
  });

  it("scripts/download-geoip.ts exists on disk", () => {
    const projectRoot = resolve(import.meta.dirname, "..", "..");
    const scriptPath = resolve(projectRoot, "scripts", "download-geoip.ts");
    expect(readFileSync(scriptPath, "utf8").length).toBeGreaterThan(0);
  });
});
