import { describe, expect, it } from "vitest";

import { auditRlsCoverage } from "../../src/core/permissions/rls-audit-planner.js";

/**
 * Story · RLS-coverage audit planner.
 *
 * Pure planner that, given the merged Prisma schema source and the
 * collected migrations (`{ name, sql }[]`), reports every tenant-
 * scoped model (i.e. every model whose block declares a `tenantId`
 * field) that lacks a `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
 * migration anywhere in the migration tree.
 *
 * Tenant isolation is the load-bearing guarantee of the multi-tenant
 * stack — the CASL ability layer treats RLS as the last line of
 * defense, and `bunx prisma migrate dev` will happily emit a
 * `CREATE TABLE` for a tenant-scoped model without the matching
 * `ENABLE ROW LEVEL SECURITY`. The planner closes that gap so a CI
 * gate can fail fast before such a migration ships.
 *
 * The planner is a pure function (string + structured input → list
 * of findings). The runner half lives in `scripts/check-rls.ts` and
 * does the I/O.
 */
describe("Story · RLS-audit planner — auditRlsCoverage", () => {
  it("flags a single tenant-scoped model with no RLS migration", () => {
    const schemaSource = `
      model Todo {
        id        String @id
        tenantId  String @map("tenant_id")
        title     String
        @@map("todos")
      }
    `;
    const findings = auditRlsCoverage({
      schemaSource,
      migrations: [
        {
          name: "20260101000000_init",
          sql: 'CREATE TABLE "todos" ("id" UUID NOT NULL, "tenant_id" UUID NOT NULL);',
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      model: "Todo",
      table: "todos",
      migrationsScanned: 1,
    });
  });

  it("returns no findings when the tenant-scoped model has an RLS-enabling migration", () => {
    const schemaSource = `
      model Todo {
        id        String @id
        tenantId  String @map("tenant_id")
        @@map("todos")
      }
    `;
    const findings = auditRlsCoverage({
      schemaSource,
      migrations: [
        {
          name: "20260101000000_init",
          sql: 'CREATE TABLE "todos" ("id" UUID NOT NULL);',
        },
        {
          name: "20260101000010_rls",
          sql: 'ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY;',
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("ignores non-tenant-scoped models in a mixed schema", () => {
    const schemaSource = `
      model HealthPing {
        id        String @id
        createdAt DateTime
        @@map("_health_ping")
      }
      model Tenant {
        id   String @id
        name String
        @@map("tenants")
      }
      model Todo {
        id       String @id
        tenantId String @map("tenant_id")
        @@map("todos")
      }
    `;
    const findings = auditRlsCoverage({
      schemaSource,
      migrations: [
        {
          name: "20260101_init",
          sql: 'ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY;',
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("flags the only tenant-scoped model in a mixed schema when RLS is missing", () => {
    const schemaSource = `
      model HealthPing { id String @id }
      model Tenant     { id String @id name String }
      model Todo {
        id       String @id
        tenantId String @map("tenant_id")
        @@map("todos")
      }
    `;
    const findings = auditRlsCoverage({
      schemaSource,
      migrations: [
        {
          name: "20260101_init",
          sql: 'CREATE TABLE "todos" ("id" UUID NOT NULL);',
        },
      ],
    });
    expect(findings.map((f) => f.model)).toEqual(["Todo"]);
  });

  it("uses @@map to resolve the table name when scanning migrations", () => {
    const schemaSource = `
      model Invoice {
        id       String @id
        tenantId String @map("tenant_id")
        @@map("custom_invoices")
      }
    `;
    const withRls = auditRlsCoverage({
      schemaSource,
      migrations: [
        {
          name: "20260101_rls",
          sql: 'ALTER TABLE "custom_invoices" ENABLE ROW LEVEL SECURITY;',
        },
      ],
    });
    expect(withRls).toHaveLength(0);

    // Same model, but the migration only mentions the camel-derived
    // snake_case `invoices` (the planner must NOT silently accept that —
    // the @@map override is the canonical table name).
    const withWrongTable = auditRlsCoverage({
      schemaSource,
      migrations: [
        {
          name: "20260101_rls",
          sql: 'ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;',
        },
      ],
    });
    expect(withWrongTable).toHaveLength(1);
    expect(withWrongTable[0]).toMatchObject({
      model: "Invoice",
      table: "custom_invoices",
    });
  });

  it("ignores `tenant_id` mentions in SQL comments — only ALTER TABLE … ENABLE RLS counts", () => {
    const schemaSource = `
      model Todo {
        id       String @id
        tenantId String @map("tenant_id")
        @@map("todos")
      }
    `;
    const findings = auditRlsCoverage({
      schemaSource,
      migrations: [
        {
          name: "20260101_init",
          sql: [
            "-- todo: enable RLS on todos.tenant_id later",
            '-- ALTER TABLE "todos" ENABLE ROW LEVEL SECURITY; (commented out)',
            'CREATE TABLE "todos" ("id" UUID NOT NULL, "tenant_id" UUID NOT NULL);',
          ].join("\n"),
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.model).toBe("Todo");
  });

  it("returns an empty list when the schema has no models", () => {
    const findings = auditRlsCoverage({
      schemaSource: "// just a banner comment\n",
      migrations: [],
    });
    expect(findings).toHaveLength(0);
  });

  it("returns an empty list when the schema has no tenant-scoped models", () => {
    const schemaSource = `
      model HealthPing {
        id        String @id
        createdAt DateTime
        @@map("_health_ping")
      }
      model Tenant {
        id   String @id
        name String
        @@map("tenants")
      }
    `;
    const findings = auditRlsCoverage({
      schemaSource,
      migrations: [{ name: "20260101_init", sql: "-- nothing" }],
    });
    expect(findings).toHaveLength(0);
  });

  it("matches the ALTER TABLE …ENABLE RLS regardless of whitespace and quoting", () => {
    const schemaSource = `
      model Todo {
        id       String @id
        tenantId String @map("tenant_id")
        @@map("todos")
      }
    `;
    // Unquoted table name + multiple spaces + lower-case keywords — the
    // planner should still recognise this as the canonical RLS opt-in.
    const findings = auditRlsCoverage({
      schemaSource,
      migrations: [
        {
          name: "20260101_rls",
          sql: "alter   table  todos   enable   row   level   security ;",
        },
      ],
    });
    expect(findings).toHaveLength(0);
  });

  it("does not register `tenant_id` in a comment line inside a model block as a tenant-scope signal", () => {
    // A model that *talks about* tenant_id in a `//` comment but does not
    // actually declare a `tenantId` field is NOT tenant-scoped and must
    // not trigger a finding even when no RLS migration exists.
    const schemaSource = `
      model AuditLog {
        id String @id
        // tenant_id intentionally omitted — audit logs are global.
        message String
        @@map("audit_logs")
      }
    `;
    const findings = auditRlsCoverage({
      schemaSource,
      migrations: [],
    });
    expect(findings).toHaveLength(0);
  });
});
