#!/usr/bin/env bun
/**
 * `bun run check:rls` — fails when a tenant-scoped Prisma model has
 * no `ENABLE ROW LEVEL SECURITY` migration anywhere in the tree.
 *
 * Tenant isolation in this template rests on Postgres RLS — every
 * `runWithRlsTenant` wrapper, every `tenant_isolation_<table>`
 * policy, every `@Can(...)` permission rule assumes RLS is on for
 * tenant-scoped tables. But `bunx prisma migrate dev` does NOT emit
 * `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for a new model with a
 * `tenantId` column — so a forgotten manual migration ships a
 * tenant-leaky table without warning.
 *
 * This runner is deliberately a separate CI gate (not a Prisma plugin
 * / migrate hook): the audit lives next to `bun run test:e2e`, runs
 * in CI exactly once per push, and surfaces with an actionable error
 * message. Wrapping `prisma migrate dev` would need a custom Prisma
 * plugin trampoline + a `postinstall` shim to make the hook
 * discoverable for everyone — too much surface area for a single
 * lint rule.
 *
 * The runner is the thin I/O layer. The pure planner
 * (`auditRlsCoverage`) is exhaustively unit-tested in
 * `tests/stories/rls-audit-planner.story.test.ts`.
 *
 * Exit code:
 *   - 0 — no findings (clean).
 *   - 1 — one or more tenant-scoped models lack an RLS migration.
 *   - 2 — runner failure (missing schema / migrations dir / read err).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  type RlsAuditFinding,
  auditRlsCoverage,
} from "../src/core/permissions/rls-audit-planner.js";

const ROOT = process.cwd();
const PRISMA_DIR = resolve(ROOT, "prisma");
const SCHEMA_PATH = resolve(PRISMA_DIR, "schema.prisma");
const GENERATED_SCHEMA_PATH = resolve(PRISMA_DIR, "schema.generated.prisma");
const MIGRATIONS_DIR = resolve(PRISMA_DIR, "migrations");

function fail(message: string, code = 2): never {
  console.error(`[check:rls] ${message}`);
  process.exit(code);
}

if (!existsSync(SCHEMA_PATH)) {
  fail(`missing schema at ${SCHEMA_PATH}`);
}
if (!existsSync(MIGRATIONS_DIR)) {
  fail(`missing migrations directory at ${MIGRATIONS_DIR}`);
}

// Prefer the merged feature schema if it has been written by
// `prepare:schema` — that's what `prisma migrate` actually consumes.
// Fall back to the core schema if not.
const schemaSource = existsSync(GENERATED_SCHEMA_PATH)
  ? readFileSync(GENERATED_SCHEMA_PATH, "utf8")
  : readFileSync(SCHEMA_PATH, "utf8");

const migrations: { name: string; sql: string }[] = [];
for (const entry of readdirSync(MIGRATIONS_DIR)) {
  const dir = resolve(MIGRATIONS_DIR, entry);
  if (!statSync(dir).isDirectory()) continue;
  const sqlPath = resolve(dir, "migration.sql");
  if (!existsSync(sqlPath)) continue;
  migrations.push({ name: entry, sql: readFileSync(sqlPath, "utf8") });
}

const findings: RlsAuditFinding[] = auditRlsCoverage({ schemaSource, migrations });

// Count tenant-scoped models for an informative success line. Every
// model that the planner reports against an empty-migrations input is
// tenant-scoped (each one is "uncovered"); subtract nothing — that's
// the canonical count regardless of how many were covered this run.
const tenantScopedCount = auditRlsCoverage({ schemaSource, migrations: [] }).length;

if (findings.length === 0) {
  console.log(
    `[check:rls] clean (${tenantScopedCount} tenant-scoped model(s), ${migrations.length} migration(s) scanned)`,
  );
  process.exit(0);
}

console.error(
  `[check:rls] ${findings.length} tenant-scoped model(s) lack an ENABLE ROW LEVEL SECURITY migration:`,
);
for (const f of findings) {
  console.error(
    `  - RLS missing: ${f.model} (table: ${f.table}) — add ENABLE ROW LEVEL SECURITY migration`,
  );
}
console.error("");
console.error(
  "Fix: create a migration that runs `ALTER TABLE \"<table>\" ENABLE ROW LEVEL SECURITY;`",
);
console.error("plus a `CREATE POLICY` matching tenant_id = current_setting('app.tenant_id').");
console.error("See prisma/migrations/20260428000150_rls_tenant_isolation_extended/ for the shape.");
process.exit(1);
