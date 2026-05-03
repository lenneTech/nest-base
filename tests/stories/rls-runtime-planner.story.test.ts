import { describe, expect, it } from "vitest";

import { auditRlsRuntime } from "../../src/core/permissions/rls-runtime-planner.js";

/**
 * Story · RLS-runtime audit planner.
 *
 * The static `auditRlsCoverage` planner only sees the migration files
 * on disk. A consumer can edit a migration file *after* it has run
 * (`prisma migrate deploy` records its hash, but the file content
 * stays editable) and the static scan will green even though the live
 * database has `pg_class.relrowsecurity = false`. This planner closes
 * that gap: given the list of tenant-scoped tables resolved from the
 * Prisma schema and a snapshot of `pg_class.relrowsecurity`, it
 * reports every tenant-scoped table whose runtime RLS flag is off
 * (or whose row is missing entirely — the table was never created).
 *
 * Same finding shape as `rls-audit-planner.ts` for consistency, plus
 * a `reason` discriminator so the runner can render a useful message
 * for the two distinct failure modes.
 */
describe("Story · RLS-runtime planner — auditRlsRuntime", () => {
  it("returns no findings when every tenant-scoped table has RLS on at runtime", () => {
    const findings = auditRlsRuntime({
      tenantScopedModels: [
        { model: "Todo", table: "todos" },
        { model: "Note", table: "notes" },
      ],
      dbState: {
        todos: true,
        notes: true,
      },
    });
    expect(findings).toEqual([]);
  });

  it("flags a tenant-scoped table whose runtime RLS flag is off", () => {
    const findings = auditRlsRuntime({
      tenantScopedModels: [
        { model: "Todo", table: "todos" },
        { model: "Note", table: "notes" },
      ],
      dbState: {
        todos: true,
        notes: false,
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      model: "Note",
      table: "notes",
      reason: "rls-disabled",
    });
  });

  it("flags a tenant-scoped table whose row is missing from pg_class entirely", () => {
    // Either the migration was never deployed, or the table lives in a
    // non-public schema the runner did not query. Either way, the
    // table is not protected as the schema promises.
    const findings = auditRlsRuntime({
      tenantScopedModels: [
        { model: "Todo", table: "todos" },
        { model: "Phantom", table: "phantoms" },
      ],
      dbState: {
        todos: true,
        // phantoms missing entirely.
      },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      model: "Phantom",
      table: "phantoms",
      reason: "table-missing",
    });
  });

  it("returns no findings when the model list is empty (nothing to protect)", () => {
    const findings = auditRlsRuntime({
      tenantScopedModels: [],
      dbState: {
        todos: true,
        notes: false,
      },
    });
    expect(findings).toEqual([]);
  });

  it("reports each tenant-scoped table independently when a mix of issues is present", () => {
    const findings = auditRlsRuntime({
      tenantScopedModels: [
        { model: "Todo", table: "todos" },
        { model: "Note", table: "notes" },
        { model: "Phantom", table: "phantoms" },
      ],
      dbState: {
        todos: true,
        notes: false,
        // phantoms missing entirely.
      },
    });
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.table).sort()).toEqual(["notes", "phantoms"]);
    const note = findings.find((f) => f.table === "notes");
    const phantom = findings.find((f) => f.table === "phantoms");
    expect(note?.reason).toBe("rls-disabled");
    expect(phantom?.reason).toBe("table-missing");
  });
});
