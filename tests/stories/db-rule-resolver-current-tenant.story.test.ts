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

  it("falls through to the literal when ctx.tenantId is undefined", () => {
    // Defense: legacy callers that build a context without a tenantId
    // get a deterministic literal back instead of `undefined`. The
    // resulting condition will not match any real row → safe failure.
    const rows: DbPermissionRow[] = [
      {
        resource: "Example",
        action: "READ",
        itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
        fields: [],
      },
    ];
    const noTenantCtx: ResolveContext = { userId: "user-1", now: ctx.now };
    const rules = resolveDbRules(rows, noTenantCtx);
    // The literal `$CURRENT_TENANT` survives the substitution pass —
    // CASL will compare it to row.tenantId and naturally deny.
    expect(rules[0]!.conditions).toEqual({ tenantId: "$CURRENT_TENANT" });
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
