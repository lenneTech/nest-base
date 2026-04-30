import { describe, expect, it } from "vitest";

import { buildAbility, type AbilityRule } from "../../src/core/permissions/casl-ability.js";

/**
 * Story · CASL Integration.
 *
 * The ability factory consumes the rule shape produced by the
 * DB-Rule → CASL-Rule resolver (next slice). Each rule is `{ action,
 * subject, conditions?, fields? }`. The factory returns a frozen
 * `Ability` instance whose `can()` / `cannot()` reflect the input set.
 */
describe("Story · CASL ability builder", () => {
  it("grants the listed action+subject combinations", () => {
    const rules: AbilityRule[] = [
      { action: "read", subject: "Project" },
      { action: "create", subject: "Project" },
    ];
    const ability = buildAbility(rules);
    expect(ability.can("read", "Project")).toBe(true);
    expect(ability.can("create", "Project")).toBe(true);
    expect(ability.can("delete", "Project")).toBe(false);
  });

  it("honors conditions via `accessibleBy`-style record matching", () => {
    const ability = buildAbility([
      { action: "read", subject: "Project", conditions: { tenantId: "t1" } },
    ]);
    expect(ability.can("read", { __caslSubjectType__: "Project", tenantId: "t1" })).toBe(true);
    expect(ability.can("read", { __caslSubjectType__: "Project", tenantId: "other" })).toBe(false);
  });

  it("grants `manage` as a wildcard over all CRUD actions", () => {
    const ability = buildAbility([{ action: "manage", subject: "Project" }]);
    for (const action of ["create", "read", "update", "delete"]) {
      expect(ability.can(action, "Project"), `action=${action}`).toBe(true);
    }
  });

  it("field-level: a fields-allowlist limits which props are readable", () => {
    const ability = buildAbility([{ action: "read", subject: "User", fields: ["id", "email"] }]);
    expect(ability.can("read", "User", "id")).toBe(true);
    expect(ability.can("read", "User", "email")).toBe(true);
    expect(ability.can("read", "User", "passwordHash")).toBe(false);
  });

  it("an empty rule set denies everything", () => {
    const ability = buildAbility([]);
    expect(ability.can("read", "Project")).toBe(false);
    expect(ability.can("create", "Project")).toBe(false);
  });

  it("the returned ability is frozen — rebuild for changes", () => {
    const ability = buildAbility([{ action: "read", subject: "Project" }]);
    expect(() => ability.update([{ action: "manage", subject: "all" }])).toThrow();
  });
});
