import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Consumer-facing docs.
 *
 * Three guides land in `docs/` for projects consuming the
 * template:
 *
 *   - docs/consumer-guide.md          how to start a project on
 *                                     top of this template
 *   - docs/api-stability-promise.md   what we mean by stable, what
 *                                     can break, how versions are
 *                                     bumped
 *   - docs/webhook-spec.md            outgoing-webhook contract
 *                                     (Standard Webhooks-style:
 *                                     headers, signature, retry
 *                                     policy, replay protection)
 *
 * The audit pins the load-bearing sections each guide must carry.
 */
describe("Story · Consumer docs", () => {
  function read(relPath: string): string {
    const full = resolve(ROOT, relPath);
    expect(existsSync(full), `${relPath} must exist`).toBe(true);
    return readFileSync(full, "utf8");
  }

  describe("docs/consumer-guide.md", () => {
    const file = "docs/consumer-guide.md";

    it("explains how to bootstrap a new project from the template", () => {
      const content = read(file);
      expect(content).toMatch(/lt fullstack init|sync:from-template|template/i);
    });

    it("points consumers at the setup wizard", () => {
      expect(read(file)).toMatch(/bun run setup/);
    });

    it("explains the env-var contract (DATABASE_URL + BETTER_AUTH_SECRET)", () => {
      const content = read(file);
      expect(content).toContain("DATABASE_URL");
      expect(content).toContain("BETTER_AUTH_SECRET");
    });

    it("documents the four CI gates that must stay green", () => {
      const content = read(file);
      expect(content.toLowerCase()).toContain("lint");
      expect(content.toLowerCase()).toContain("test");
      expect(content.toLowerCase()).toContain("build");
      expect(content.toLowerCase()).toContain("coverage");
    });

    it("points at the customization-guide for src/modules/ work", () => {
      expect(read(file)).toMatch(/customization-guide/);
    });
  });

  describe("docs/api-stability-promise.md", () => {
    const file = "docs/api-stability-promise.md";

    it("declares the semver convention used by the template", () => {
      expect(read(file)).toMatch(/semver|major|minor|patch/i);
    });

    it("lists what is considered a public API surface (and what is not)", () => {
      const content = read(file);
      expect(content.toLowerCase()).toContain("src/core/");
      expect(content.toLowerCase()).toContain("src/modules/");
    });

    it("declares the deprecation window before a breaking change ships", () => {
      const content = read(file);
      expect(content).toMatch(/deprecat/i);
    });

    it("mentions the migration-guide convention for breaking changes", () => {
      expect(read(file)).toMatch(/migration/i);
    });
  });

  describe("docs/webhook-spec.md", () => {
    const file = "docs/webhook-spec.md";

    it("declares the signature header (HMAC-SHA256, Standard Webhooks)", () => {
      const content = read(file);
      expect(content).toMatch(/HMAC-SHA256/i);
      expect(content).toMatch(/standard-webhooks|standard webhooks/i);
    });

    it("documents the t=,v1= header format the dispatcher emits", () => {
      const content = read(file);
      expect(content).toMatch(/t=/);
      expect(content).toMatch(/v1=/);
    });

    it("describes the retry policy (exponential backoff, max attempts, auto-disable)", () => {
      const content = read(file);
      expect(content).toMatch(/retry|backoff/i);
      expect(content).toMatch(/auto-?disable|disabl/i);
    });

    it("describes replay-protection / clock-skew tolerance", () => {
      const content = read(file);
      expect(content).toMatch(/replay|skew|tolerance/i);
    });

    it("points consumers at the Webhook-Inspector for delivery diagnostics", () => {
      expect(read(file)).toMatch(/admin\/webhooks|Webhook[- ]Inspector/);
    });
  });

  describe("cross-references", () => {
    it("the README links each of the three consumer docs", () => {
      const readme = read("README.md");
      expect(readme).toMatch(/consumer-guide\.md/);
      expect(readme).toMatch(/api-stability-promise\.md/);
      expect(readme).toMatch(/webhook-spec\.md/);
    });
  });
});
