import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");

function blockOf(model: string): string {
  const re = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
  const match = SCHEMA.match(re);
  expect(match, `model ${model} not found`).not.toBeNull();
  return match![0];
}

/**
 * Permission-system schema (PLAN.md §6.3).
 *
 * Adds the Directus-style RBAC backbone: Role inherits from Role,
 * Policies group Permissions, RolePolicy is the join table. Permissions
 * carry resource + action + optional item-filter / field-allowlist /
 * validation / presets payloads.
 */
describe("Permission-system schema", () => {
  describe("Role enrichment", () => {
    const block = (): string => blockOf("Role");

    it("has description / isSystem / isPublic flags", () => {
      const b = block();
      expect(b).toMatch(/description\s+String\?/);
      expect(b).toMatch(/isSystem[\s\S]*@map\(\s*"is_system"\s*\)/);
      expect(b).toMatch(/isPublic[\s\S]*@map\(\s*"is_public"\s*\)/);
    });

    it("models hierarchical inheritance via parentId / parent / children", () => {
      const b = block();
      expect(b).toMatch(/parentId[\s\S]*@map\(\s*"parent_id"\s*\)/);
      expect(b).toMatch(/parent\s+Role\?/);
      expect(b).toMatch(/children\s+Role\[\]/);
      expect(b).toMatch(/relation\(\s*"RoleHierarchy"/);
    });

    it("points at policies via the RolePolicy join", () => {
      expect(block()).toMatch(/policies\s+RolePolicy\[\]/);
    });
  });

  describe("Policy model", () => {
    const block = (): string => blockOf("Policy");

    it("exists and maps to `policies`", () => {
      expect(block()).toMatch(/@@map\(\s*"policies"\s*\)/);
    });

    it("has unique name + description + permissions + roles relations", () => {
      const b = block();
      expect(b).toMatch(/name\s+String\s+@unique/);
      expect(b).toMatch(/description\s+String\?/);
      expect(b).toMatch(/permissions\s+Permission\[\]/);
      expect(b).toMatch(/roles\s+RolePolicy\[\]/);
    });
  });

  describe("RolePolicy join model", () => {
    const block = (): string => blockOf("RolePolicy");

    it("maps to `role_policies`", () => {
      expect(block()).toMatch(/@@map\(\s*"role_policies"\s*\)/);
    });

    it("uses (roleId, policyId) as the composite primary key", () => {
      expect(block()).toMatch(/@@id\(\s*\[\s*roleId\s*,\s*policyId\s*\]\s*\)/);
    });

    it("cascades when either side is deleted", () => {
      const b = block();
      const cascadeMatches = b.match(/onDelete:\s*Cascade/g) ?? [];
      expect(cascadeMatches.length).toBe(2);
    });
  });

  describe("Permission model", () => {
    const block = (): string => blockOf("Permission");

    it("maps to `permissions` and is unique on (policy_id, resource, action)", () => {
      const b = block();
      expect(b).toMatch(/@@map\(\s*"permissions"\s*\)/);
      expect(b).toMatch(/@@unique\(\s*\[\s*policyId\s*,\s*resource\s*,\s*action\s*\]\s*\)/);
    });

    it("carries resource + action enum + optional itemFilter / fields / validation / presets", () => {
      const b = block();
      expect(b).toMatch(/resource\s+String/);
      expect(b).toMatch(/action\s+PermissionAction/);
      expect(b).toMatch(/itemFilter\s+Json\?/);
      expect(b).toMatch(/fields\s+String\[\]/);
      expect(b).toMatch(/validation\s+Json\?/);
      expect(b).toMatch(/presets\s+Json\?/);
    });
  });

  describe("PermissionAction enum", () => {
    it("declares the five core actions", () => {
      expect(SCHEMA).toMatch(
        /enum\s+PermissionAction\s*\{[\s\S]*CREATE[\s\S]*READ[\s\S]*UPDATE[\s\S]*DELETE[\s\S]*SHARE[\s\S]*\}/,
      );
    });
  });
});
