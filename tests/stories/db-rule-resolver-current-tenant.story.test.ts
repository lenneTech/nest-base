import { describe, expect, it } from "vitest";

import {
  type DbPermissionRow,
  type ResolveContext,
  resolveDbRules,
} from "../../src/core/permissions/db-rule-resolver.js";

/**
 * Story · `$CURRENT_TENANT` variable substitution.
 *
 * The persistent permission DSL supports three variables:
 * `$CURRENT_USER`, `$NOW` (already implemented), and `$CURRENT_TENANT`
 * — the last is the missing piece that lets the default Member role
 * scope every rule to the caller's tenant. Without it, a Member-role
 * rule like `{ tenantId: { _eq: "$CURRENT_TENANT" } }` would compare
 * the row's `tenantId` to the literal string "$CURRENT_TENANT" —
 * always false, so every request would 403.
 */
describe("Story · DB-Rule resolver · $CURRENT_TENANT", () => {
  const ctx: ResolveContext = {
    userId: "user-1",
    tenantId: "tenant-42",
    now: new Date("2026-04-28T18:00:00Z"),
  };

  it("$CURRENT_TENANT is substituted with ctx.tenantId on _eq", () => {
    const rows: DbPermissionRow[] = [
      {
        resource: "Example",
        action: "READ",
        itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
        fields: [],
      },
    ];
    const rules = resolveDbRules(rows, ctx);
    expect(rules[0]!.conditions).toEqual({ tenantId: "tenant-42" });
  });

  it("$CURRENT_TENANT is substituted inside arrays (_in)", () => {
    const rows: DbPermissionRow[] = [
      {
        resource: "Example",
        action: "READ",
        itemFilter: { tenantId: { _in: ["$CURRENT_TENANT", "shared"] } },
        fields: [],
      },
    ];
    const rules = resolveDbRules(rows, ctx);
    expect(rules[0]!.conditions).toEqual({ tenantId: { $in: ["tenant-42", "shared"] } });
  });

  it("throws when ctx.tenantId is undefined but a rule references $CURRENT_TENANT (NIT-3)", () => {
    // NIT-3: A $CURRENT_TENANT reference without a tenantId in context
    // is a misconfigured caller. The previous behaviour (pass the literal
    // through) caused silent deny-all. Now we throw to surface the bug
    // early at the call-site.
    const rows: DbPermissionRow[] = [
      {
        resource: "Example",
        action: "READ",
        itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
        fields: [],
      },
    ];
    const noTenantCtx: ResolveContext = { userId: "user-1", now: ctx.now };
    expect(() => resolveDbRules(rows, noTenantCtx)).toThrow(/\$CURRENT_TENANT.*no tenantId/i);
  });

  it("does NOT throw for rules without $CURRENT_TENANT when ctx.tenantId is undefined", () => {
    const rows: DbPermissionRow[] = [
      {
        resource: "Example",
        action: "READ",
        itemFilter: { ownerId: { _eq: "$CURRENT_USER" } },
        fields: [],
      },
    ];
    const noTenantCtx: ResolveContext = { userId: "user-1", now: ctx.now };
    // Must not throw — tenantId is not referenced in this rule.
    const rules = resolveDbRules(rows, noTenantCtx);
    expect(rules[0]!.conditions).toEqual({ ownerId: "user-1" });
  });

  it("$CURRENT_USER and $CURRENT_TENANT can co-exist", () => {
    const rows: DbPermissionRow[] = [
      {
        resource: "Example",
        action: "READ",
        itemFilter: {
          tenantId: { _eq: "$CURRENT_TENANT" },
          ownerId: { _eq: "$CURRENT_USER" },
        },
        fields: [],
      },
    ];
    const rules = resolveDbRules(rows, ctx);
    expect(rules[0]!.conditions).toEqual({
      tenantId: "tenant-42",
      ownerId: "user-1",
    });
  });
});
