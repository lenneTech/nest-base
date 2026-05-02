import { describe, expect, it } from "vitest";

import {
  DEFAULT_MEMBER_RESOURCES,
  buildMemberRoleRules,
} from "../../src/core/permissions/member-role-rules.js";

/**
 * Story · Default "Member" role rule planner.
 *
 * A pure planner that produces the `DbPermissionRow[]` shape the
 * resolver consumes for a user who is an `ACTIVE` member of a tenant.
 * Each rule is `manage` on a known resource subject, scoped to the
 * caller's current tenant via `$CURRENT_TENANT` — so the member can
 * only operate on their own tenant's records, never another's.
 *
 * Why a list of subjects and not just `'all'`: CASL's `manage` on
 * `'all'` would also let a member modify framework-internal subjects
 * (Role, Policy, Permission, …) which the project ships as admin-only.
 * The default list enumerates the project-facing resource names so an
 * admin auditing the abilities sees an honest catalogue.
 */
describe("Story · buildMemberRoleRules", () => {
  it("returns one row per known resource", () => {
    const rules = buildMemberRoleRules();
    expect(rules.length).toBe(DEFAULT_MEMBER_RESOURCES.length);
    expect(rules.map((r) => r.resource).sort()).toEqual([...DEFAULT_MEMBER_RESOURCES].sort());
  });

  it("every rule grants the `manage` action (CASL: covers all CRUD verbs)", () => {
    const rules = buildMemberRoleRules();
    for (const rule of rules) {
      // We persist the action verbatim — the resolver lowercases it.
      // The persisted shape uses the SQL enum vocabulary, so we add a
      // synthetic 'MANAGE' that the CASL ability builder understands.
      // (PermissionAction enum is intentionally a closed set on the DB
      // side; this rule lives in-memory only — never written to the DB.)
      expect(rule.action).toBe("MANAGE");
    }
  });

  it("every rule scopes to the caller's tenant via $CURRENT_TENANT", () => {
    const rules = buildMemberRoleRules();
    for (const rule of rules) {
      expect(rule.itemFilter).toEqual({ tenantId: { _eq: "$CURRENT_TENANT" } });
    }
  });

  it("uses an empty fields[] array (= no field-level restriction)", () => {
    const rules = buildMemberRoleRules();
    for (const rule of rules) {
      expect(rule.fields).toEqual([]);
    }
  });

  it("DEFAULT_MEMBER_RESOURCES does not include framework-admin subjects", () => {
    // Defense in depth — accidentally letting 'Role' / 'Policy' /
    // 'Permission' into the default list would let any tenant member
    // mint themselves an admin.
    const forbidden = ["Role", "Policy", "Permission", "RolePolicy", "Tenant"];
    for (const banned of forbidden) {
      expect(DEFAULT_MEMBER_RESOURCES).not.toContain(banned);
    }
  });

  it("supports overriding the resource list", () => {
    const rules = buildMemberRoleRules({ resources: ["Project", "Task"] });
    expect(rules.map((r) => r.resource)).toEqual(["Project", "Task"]);
  });

  it("is deterministic — same input → equal output", () => {
    expect(buildMemberRoleRules()).toEqual(buildMemberRoleRules());
  });
});
