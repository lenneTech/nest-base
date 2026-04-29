import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Template-Tooling docs (PLAN.md §32 Phase 7).
 *
 * Three guides need to exist next to the planners they document so a
 * project consumer can answer the three questions a Template-shaped
 * project surfaces in practice:
 *
 *   1. How do I update src/core/ to the latest template?
 *      → docs/template-update-workflow.md
 *   2. Where do I put project-specific code, and what stays in core?
 *      → docs/customization-guide.md
 *   3. I improved something in src/core/ — how do I PR it back?
 *      → docs/core-contribution-guide.md
 *
 * The test isn't a copy-edit gate — it just pins the load-bearing
 * sections each guide must cover so future doc rewrites can't
 * accidentally drop one (§32 explicitly lists these three guides).
 */
describe("Story · Template-Tooling docs", () => {
  function read(relPath: string): string {
    const full = resolve(ROOT, relPath);
    expect(existsSync(full), `${relPath} must exist`).toBe(true);
    return readFileSync(full, "utf8");
  }

  describe("docs/template-update-workflow.md", () => {
    const file = "docs/template-update-workflow.md";

    it("explains the sync:from-template command", () => {
      const content = read(file);
      expect(content).toMatch(/sync:from-template/);
      expect(content).toMatch(/bun run sync:from-template/);
    });

    it("documents the src/core vs src/modules boundary", () => {
      const content = read(file);
      expect(content).toMatch(/src\/core\//);
      expect(content).toMatch(/src\/modules\//);
    });

    it("lists the create / update / skip / delete bucket names so logs are readable", () => {
      const content = read(file);
      expect(content.toLowerCase()).toContain("create");
      expect(content.toLowerCase()).toContain("update");
      expect(content.toLowerCase()).toContain("skip");
      expect(content.toLowerCase()).toContain("delete");
    });

    it("mentions that running prepare:schema follows a sync", () => {
      const content = read(file);
      expect(content).toMatch(/prepare:schema/);
    });
  });

  describe("docs/customization-guide.md", () => {
    const file = "docs/customization-guide.md";

    it("declares src/modules/ as the project-specific area", () => {
      const content = read(file);
      expect(content).toMatch(/src\/modules\//);
    });

    it("declares src/core/ as the synchronised template area (do not edit casually)", () => {
      const content = read(file);
      expect(content).toMatch(/src\/core\//);
    });

    it("points at features.ts as the activation surface", () => {
      const content = read(file);
      expect(content).toMatch(/features\.ts|FeaturesSchema/);
    });

    it("shows where to add a new resource (model + service + controller)", () => {
      const content = read(file);
      expect(content.toLowerCase()).toContain("model");
      expect(content.toLowerCase()).toContain("service");
      expect(content.toLowerCase()).toContain("controller");
    });
  });

  describe("docs/core-contribution-guide.md", () => {
    const file = "docs/core-contribution-guide.md";

    it("explains the sync:to-template command", () => {
      const content = read(file);
      expect(content).toMatch(/sync:to-template/);
      expect(content).toMatch(/bun run sync:to-template/);
    });

    it("describes the resulting patch artifact (so reviewers know where it lands)", () => {
      const content = read(file);
      expect(content).toMatch(/core-pr\.patch|patch/i);
    });

    it("lists the add / modify / skip / remove buckets", () => {
      const content = read(file);
      const lower = content.toLowerCase();
      expect(lower).toContain("add");
      expect(lower).toContain("modify");
      expect(lower).toContain("skip");
      expect(lower).toContain("remove");
    });

    it("mentions the template repo as the upstream (so a contributor knows where the PR goes)", () => {
      const content = read(file);
      expect(content.toLowerCase()).toContain("template");
      expect(content.toLowerCase()).toContain("upstream");
    });
  });

  describe("cross-references", () => {
    it("the README links each of the three template guides", () => {
      const readme = read("README.md");
      expect(readme).toMatch(/template-update-workflow\.md/);
      expect(readme).toMatch(/customization-guide\.md/);
      expect(readme).toMatch(/core-contribution-guide\.md/);
    });
  });
});
