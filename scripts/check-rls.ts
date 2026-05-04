#!/usr/bin/env bun
// Force the workspace `.env` to win over inherited shell env. Without
// this, a stale `DATABASE_URL` exported in the parent shell silently
// shadows the workspace's `projects/api/.env`, so the runtime scan
// connects to the wrong DB and reports false missing-tables. Matches
// the pattern in `prisma.config.ts` + `scripts/dev.ts` so every
// per-workspace tool agrees on the same DB regardless of shell state.
import { config as loadEnv } from "dotenv";

loadEnv({ override: true });

/**
 * `bun run check:rls` — fails when a tenant-scoped Prisma model has
 * no `ENABLE ROW LEVEL SECURITY` migration anywhere in the tree
 * AND/OR (in runtime mode) the live Postgres has
 * `pg_class.relrowsecurity = false` on a tenant-scoped table.
 *
 * Tenant isolation in this template rests on Postgres RLS — every
 * `runWithRlsTenant` wrapper, every `tenant_isolation_<table>`
 * policy, every `@Can(...)` permission rule assumes RLS is on for
 * tenant-scoped tables. But `bunx prisma migrate dev` does NOT emit
 * `ALTER TABLE … ENABLE ROW LEVEL SECURITY` for a new model with a
 * `tenantId` column — so a forgotten manual migration ships a
 * tenant-leaky table without warning.
 *
 * Two modes coexist on purpose:
 *
 *   - **Static** (always runs) — scans the migration files on disk
 *     for the `ENABLE ROW LEVEL SECURITY` statement. Cheap, no DB,
 *     this is what the `lint` CI job runs.
 *
 *   - **Runtime** (when `DATABASE_URL` is set OR `--runtime` is
 *     passed) — connects to Postgres and reads `pg_class.relrowsecurity`
 *     for every tenant-scoped table. This catches the failure mode the
 *     static scan can't: a consumer edits a migration file *after* it
 *     was applied (Prisma records the migration's hash but doesn't
 *     re-check the file), and the live table ends up unprotected
 *     even though the static scan stays green.
 *
 * Use `--strict` to fail when the runtime check is skipped — useful
 * in pre-prod CI gates that should never accept a static-only pass.
 *
 * The runner is the thin I/O layer. The two pure planners
 * (`auditRlsCoverage`, `auditRlsRuntime`) are exhaustively unit-tested
 * in `tests/stories/rls-audit-planner.story.test.ts` and
 * `tests/stories/rls-runtime-planner.story.test.ts`.
 *
 * Exit code:
 *   - 0 — no findings (clean).
 *   - 1 — one or more tenant-scoped models lack an RLS migration,
 *         OR the live DB has RLS off on a tenant-scoped table,
 *         OR `--strict` was set and the runtime check was skipped.
 *   - 2 — runner failure (missing schema / migrations dir / read err).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import {
  type RlsAuditFinding,
  auditRlsCoverage,
  listTenantScopedModels,
} from "../src/core/permissions/rls-audit-planner.js";
import {
  type RlsRuntimeFinding,
  connectAndCheckRlsAtRuntime,
} from "../src/core/permissions/rls-runtime-check.js";

const ROOT = process.cwd();
const PRISMA_DIR = resolve(ROOT, "prisma");
const SCHEMA_PATH = resolve(PRISMA_DIR, "schema.prisma");
const GENERATED_SCHEMA_PATH = resolve(PRISMA_DIR, "schema.generated.prisma");
const MIGRATIONS_DIR = resolve(PRISMA_DIR, "migrations");

const argv = process.argv.slice(2);
const FORCE_RUNTIME = argv.includes("--runtime");
const STRICT = argv.includes("--strict");

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

// ─── Static scan (always) ───────────────────────────────────────────
const staticFindings: RlsAuditFinding[] = auditRlsCoverage({ schemaSource, migrations });
const tenantScoped = listTenantScopedModels(schemaSource);

// ─── Runtime check (conditional) ────────────────────────────────────
const databaseUrl = process.env.DATABASE_URL;
const runtimeRequested = FORCE_RUNTIME || databaseUrl !== undefined;

let runtimeFindings: RlsRuntimeFinding[] = [];
let runtimeSkipped = false;
let runtimeSkipReason = "";

if (runtimeRequested) {
  if (!databaseUrl) {
    // `--runtime` forced but no DATABASE_URL — escalate to exit 2:
    // the user explicitly asked for runtime verification and we
    // can't honour it.
    fail("--runtime requested but DATABASE_URL is not set", 2);
  }
  try {
    runtimeFindings = await connectAndCheckRlsAtRuntime({
      tenantScopedModels: tenantScoped,
      databaseUrl,
    });
  } catch (err) {
    fail(
      `runtime check failed to connect or query: ${err instanceof Error ? err.message : String(err)}`,
      2,
    );
  }
} else {
  runtimeSkipped = true;
  runtimeSkipReason =
    "Runtime RLS check skipped (no DATABASE_URL). " +
    "Run `bun run check:rls --runtime` locally to verify pg_class.relrowsecurity.";
}

// ─── Reporting ──────────────────────────────────────────────────────
let exitCode = 0;

if (staticFindings.length === 0) {
  console.log(
    `[check:rls] static: clean (${tenantScoped.length} tenant-scoped model(s), ${migrations.length} migration(s) scanned)`,
  );
} else {
  exitCode = 1;
  console.error(
    `[check:rls] static: ${staticFindings.length} tenant-scoped model(s) lack an ENABLE ROW LEVEL SECURITY migration:`,
  );
  for (const f of staticFindings) {
    console.error(
      `  - RLS missing: ${f.model} (table: ${f.table}) — add ENABLE ROW LEVEL SECURITY migration`,
    );
  }
}

if (runtimeSkipped) {
  if (STRICT) {
    exitCode = 1;
    console.error(`[check:rls] runtime: STRICT failure — ${runtimeSkipReason}`);
  } else {
    console.log(`[check:rls] runtime: ${runtimeSkipReason}`);
  }
} else if (runtimeFindings.length === 0) {
  console.log(
    `[check:rls] runtime: clean (${tenantScoped.length} tenant-scoped table(s) verified against pg_class.relrowsecurity)`,
  );
} else {
  exitCode = 1;
  console.error(
    `[check:rls] runtime: ${runtimeFindings.length} tenant-scoped table(s) failed the live pg_class.relrowsecurity check:`,
  );
  for (const f of runtimeFindings) {
    if (f.reason === "rls-disabled") {
      console.error(
        `  - RLS disabled at runtime: ${f.model} (table: ${f.table}) — pg_class.relrowsecurity is false`,
      );
    } else {
      console.error(
        `  - Table missing at runtime: ${f.model} (table: ${f.table}) — no row in pg_class for this table in the public schema`,
      );
    }
  }
}

if (exitCode === 1) {
  console.error("");
  console.error(
    "Fix: ensure each tenant-scoped table has `ALTER TABLE \"<table>\" ENABLE ROW LEVEL SECURITY;`",
  );
  console.error("plus a `CREATE POLICY` matching tenant_id = current_setting('app.tenant_id').");
  console.error("See prisma/migrations/20260428000150_rls_tenant_isolation_extended/ for the shape.");
  console.error(
    "If runtime findings disagree with the static scan, the migration file was edited after",
  );
  console.error(
    "deploy — re-apply RLS in a NEW migration (forward-only); never edit a shipped migration.",
  );
}

process.exit(exitCode);
