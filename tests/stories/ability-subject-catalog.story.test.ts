import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildAbilitySubjectCatalog,
  buildAbilitySubjectCatalogFromRepo,
} from "../../src/core/permissions/ability-subject-catalog.js";
import { collectGatedAbilitySubjects } from "../../src/core/permissions/route-audit-planner.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");

describe("Story · ability subject catalog", () => {
  it("merges member defaults, framework subjects, and audited @Can subjects", () => {
    const audited = collectGatedAbilitySubjects({ root: REPO_ROOT });
    const catalog = buildAbilitySubjectCatalog({ auditedSubjects: audited });
    expect(catalog).toContain("Example");
    expect(catalog).toContain("Hub");
    expect(catalog).toContain("File");
    for (const subject of audited) {
      expect(catalog).toContain(subject);
    }
    expect(catalog).toEqual([...catalog].sort((a, b) => a.localeCompare(b)));
  });

  it("buildAbilitySubjectCatalogFromRepo returns a non-empty sorted list", () => {
    const catalog = buildAbilitySubjectCatalogFromRepo(REPO_ROOT);
    expect(catalog.length).toBeGreaterThan(10);
    expect(catalog).not.toContain("all");
  });
});
