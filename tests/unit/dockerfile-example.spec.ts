import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const DOCKERFILE = resolve(ROOT, "Dockerfile.example");
const DOCKERIGNORE = resolve(ROOT, ".dockerignore");
const GITLAB_CI = resolve(ROOT, ".gitlab-ci.yml");

/**
 * `Dockerfile.example` is a reference template for consumer projects
 *. The template repository itself does NOT build,
 * sign, or publish a container — consumer projects copy/adapt this file
 * in their own repo. Tests pin the file's structural properties so a
 * regression is caught early.
 */
describe("Dockerfile.example (template reference)", () => {
  const dockerfile = existsSync(DOCKERFILE) ? readFileSync(DOCKERFILE, "utf8") : "";

  it("exists at the repo root", () => {
    expect(existsSync(DOCKERFILE)).toBe(true);
  });

  it("uses Bun as the runtime base image", () => {
    expect(dockerfile).toMatch(/FROM\s+oven\/bun/i);
  });

  it("is multi-stage (≥ 3 FROM directives for deps / build / runtime)", () => {
    const fromCount = (dockerfile.match(/^FROM\s+/gim) ?? []).length;
    expect(fromCount).toBeGreaterThanOrEqual(3);
  });

  it("declares stage names (deps / build / runtime)", () => {
    expect(dockerfile).toMatch(/AS\s+deps/i);
    expect(dockerfile).toMatch(/AS\s+build/i);
    expect(dockerfile).toMatch(/AS\s+runtime/i);
  });

  it("runs as a non-root user (`USER` directive present)", () => {
    expect(dockerfile).toMatch(/^USER\s+\w+/im);
    expect(dockerfile).not.toMatch(/^USER\s+root/im);
  });

  it("declares a HEALTHCHECK", () => {
    expect(dockerfile).toMatch(/HEALTHCHECK/);
  });

  it("exposes a port via EXPOSE", () => {
    expect(dockerfile).toMatch(/^EXPOSE\s+\d+/im);
  });

  it("carries OCI image labels (license, source) so consumers can override or inherit", () => {
    expect(dockerfile).toMatch(/org\.opencontainers\.image\.licenses/);
    expect(dockerfile).toMatch(/org\.opencontainers\.image\.title/);
  });

  it("comes with a sibling `.dockerignore` file", () => {
    expect(existsSync(DOCKERIGNORE)).toBe(true);
  });

  it(".dockerignore excludes node_modules, dist, .git, .env files", () => {
    const content = existsSync(DOCKERIGNORE) ? readFileSync(DOCKERIGNORE, "utf8") : "";
    expect(content).toMatch(/^node_modules\b/m);
    expect(content).toMatch(/^dist\b/m);
    expect(content).toMatch(/^\.git\b/m);
    expect(content).toMatch(/^\.env\b/m);
  });

  it("GitLab CI does NOT build, push, or sign a container image", () => {
    const ci = readFileSync(GITLAB_CI, "utf8");
    expect(ci).not.toMatch(/docker\s+build/i);
    expect(ci).not.toMatch(/docker\s+push/i);
    expect(ci).not.toMatch(/cosign|kaniko|buildah|skopeo/i);
  });
});
