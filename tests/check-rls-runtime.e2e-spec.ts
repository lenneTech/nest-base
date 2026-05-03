import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Client } from "pg";

import { listTenantScopedModels } from "../src/core/permissions/rls-audit-planner.js";
import { checkRlsAtRuntime } from "../src/core/permissions/rls-runtime-check.js";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E · `check:rls --runtime` against a live Postgres.
 *
 * Verifies the runtime gate that the static migration-file scan
 * cannot give: a consumer who edits an applied migration file post-
 * deploy ends up with `pg_class.relrowsecurity = false` while the
 * static planner stays green. This e2e drives the runtime check
 * against the testcontainer Postgres, manually flips RLS off on a
 * real tenant-scoped table, and asserts the finding shows up.
 *
 * The runtime check is called as a function (not via `bun run
 * check:rls --runtime`) so the test stays focused on the contract
 * — argv parsing + exit codes are covered by the runner's own
 * inline reporting.
 */
describe("E2E · check:rls runtime — live pg_class.relrowsecurity verification", () => {
  let client: Client;
  let tenantScoped: ReadonlyArray<{ model: string; table: string }>;

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL required for the check:rls runtime e2e");
    client = new Client({ connectionString: url });
    await client.connect();

    // The static planner exposes the canonical model list; reuse it
    // so the e2e doesn't drift from the source-of-truth schema.
    const schemaPath = resolve(process.cwd(), "prisma", "schema.prisma");
    const schemaSource = readFileSync(schemaPath, "utf8");
    tenantScoped = listTenantScopedModels(schemaSource);
  });

  afterAll(async () => {
    // Belt-and-braces: re-enable RLS on the table we toggled, in
    // case a test exception bypassed the per-test cleanup. Other
    // specs in the same run inherit this DB and assume RLS is on.
    try {
      await client.query("ALTER TABLE examples ENABLE ROW LEVEL SECURITY");
    } catch {
      // table may not exist on a stripped schema; ignore.
    }
    await client.end();
  });

  it("reports clean when every tenant-scoped table has RLS on at runtime", async () => {
    const findings = await checkRlsAtRuntime({ tenantScopedModels: tenantScoped, client });
    expect(findings).toEqual([]);
  });

  it("reports a finding when RLS is disabled on a tenant-scoped table at runtime", async () => {
    // Simulate a post-deploy migration-file edit: live DB has RLS
    // off even though the schema + static scan say it should be on.
    await client.query("ALTER TABLE examples DISABLE ROW LEVEL SECURITY");
    try {
      const findings = await checkRlsAtRuntime({ tenantScopedModels: tenantScoped, client });
      expect(findings.length).toBeGreaterThan(0);
      const example = findings.find((f) => f.table === "examples");
      expect(example).toBeDefined();
      expect(example?.reason).toBe("rls-disabled");
    } finally {
      // Restore for the next test (and for any other e2e that runs
      // after us against the same testcontainer DB).
      await client.query("ALTER TABLE examples ENABLE ROW LEVEL SECURITY");
    }
  });

  it("returns clean again once RLS is re-enabled on the table", async () => {
    const findings = await checkRlsAtRuntime({ tenantScopedModels: tenantScoped, client });
    expect(findings).toEqual([]);
  });
});
