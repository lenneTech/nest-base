/**
 * Thin runner around `migrations-planner.ts`.
 *
 * Owns every side effect — file system, Postgres queries, child process
 * spawns. The planner is pure and testable; this module wraps it with
 * the actual `prisma migrate` toolchain.
 *
 * Production-safety: every public function in this module is gated at
 * the controller layer behind `assertDev()` so the planner-runner pair
 * can never be invoked outside `NODE_ENV=development`.
 *
 * Concurrency: the controller acquires the advisory lock via
 * `withAdvisoryLock(...)`. Two concurrent deploy attempts on the same
 * Postgres instance see the second `pg_try_advisory_lock` return false
 * and respond 409.
 */

import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { PrismaService } from "../../prisma/prisma.service.js";

import {
  ADVISORY_LOCK_KEY,
  type AppliedMigrationRow,
  type DiskMigration,
  isValidDiskMigrationName,
  resolveMigrationDirectory,
  validateMigrationName,
} from "./migrations-planner.js";

/**
 * Read every directory under `prisma/migrations/` and return the
 * Prisma-style migration folders found there. Filters out the special
 * `migration_lock.toml` file and any non-conforming names.
 */
export function listDiskMigrations(projectRoot: string = process.cwd()): DiskMigration[] {
  const dir = resolve(projectRoot, "prisma", "migrations");
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: DiskMigration[] = [];
  for (const name of entries) {
    if (name === "migration_lock.toml") continue;
    if (name.startsWith(".")) continue;
    if (!isValidDiskMigrationName(name)) continue;
    const sub = resolve(dir, name);
    try {
      if (!statSync(sub).isDirectory()) continue;
    } catch {
      continue;
    }
    out.push({ name });
  }
  return out;
}

/**
 * Read the SQL contents of a migration folder. Throws on directory-
 * traversal attempts and missing files.
 */
export function readMigrationSql(projectRoot: string, name: string): string {
  const dir = resolveMigrationDirectory(projectRoot, name);
  const sqlPath = resolve(dir, "migration.sql");
  if (!existsSync(sqlPath)) {
    throw new Error(`Migration SQL not found: ${name}/migration.sql`);
  }
  return readFileSync(sqlPath, "utf8");
}

/**
 * Recursively delete a draft migration directory. Path-safety is
 * enforced via `resolveMigrationDirectory` — the caller cannot delete
 * anything outside `prisma/migrations/`.
 */
export function discardMigrationDirectory(projectRoot: string, name: string): boolean {
  const dir = resolveMigrationDirectory(projectRoot, name);
  if (!existsSync(dir)) return false;
  rmSync(dir, { recursive: true, force: true });
  return true;
}

/**
 * Read the `_prisma_migrations` table directly. Prisma populates this
 * table on every `migrate deploy`; reading it lets us avoid shelling
 * out to `prisma migrate status` for the read path.
 */
export async function listAppliedMigrations(prisma: PrismaService): Promise<AppliedMigrationRow[]> {
  // The table is owned by Prisma; the columns below have been stable
  // since v3.x. Using $queryRawUnsafe keeps us decoupled from generated
  // model types we don't otherwise use.
  type Row = {
    id: string;
    migration_name: string;
    started_at: Date | null;
    finished_at: Date | null;
    applied_steps_count: number | bigint;
    logs: string | null;
    rolled_back_at: Date | null;
  };
  let rows: Row[] = [];
  try {
    rows = await prisma.$queryRawUnsafe<Row[]>(
      `select id, migration_name, started_at, finished_at, applied_steps_count, logs, rolled_back_at
         from _prisma_migrations
         order by started_at asc`,
    );
  } catch {
    // Table absent (fresh database, never migrated). Empty result is the
    // signal the controller surfaces to the UI.
    return [];
  }
  return rows.map((r) => ({
    id: String(r.id),
    migration_name: r.migration_name,
    started_at: r.started_at ? r.started_at.toISOString() : new Date(0).toISOString(),
    finished_at: r.finished_at ? r.finished_at.toISOString() : null,
    applied_steps_count: Number(r.applied_steps_count ?? 0),
    logs: r.logs,
    rolled_back_at: r.rolled_back_at ? r.rolled_back_at.toISOString() : null,
  }));
}

export interface AdvisoryLockResult<T> {
  acquired: boolean;
  result?: T;
}

/**
 * Try to acquire the migrations advisory lock and run `fn` while it
 * is held. Returns `{ acquired: false }` immediately if another caller
 * already owns the lock — the controller maps this to 409.
 *
 * Lock release is best-effort: we always attempt `pg_advisory_unlock`
 * even when `fn` throws, so a panic during a migration cannot wedge
 * the next attempt indefinitely.
 */
export async function withAdvisoryLock<T>(
  prisma: PrismaService,
  fn: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  const key = ADVISORY_LOCK_KEY.toString();
  const lock = await prisma.$queryRawUnsafe<Array<{ locked: boolean }>>(
    `select pg_try_advisory_lock(${key}::bigint) as locked`,
  );
  if (!lock?.[0]?.locked) {
    return { acquired: false };
  }
  try {
    const result = await fn();
    return { acquired: true, result };
  } finally {
    try {
      await prisma.$queryRawUnsafe(`select pg_advisory_unlock(${key}::bigint)`);
    } catch {
      // The lock is connection-scoped — when the connection is recycled
      // by the pool, the lock dies with it. Logging is sufficient.
    }
  }
}

export interface PrismaCommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Spawn a `bunx prisma <args>` child process and collect stdout/stderr.
 * Args are validated by the planner before reaching this function — we
 * never pass user-controlled strings through a shell.
 */
export async function runPrismaCommand(
  args: readonly string[],
  options: { projectRoot?: string; timeoutMs?: number } = {},
): Promise<PrismaCommandResult> {
  const cwd = options.projectRoot ?? process.cwd();
  const timeoutMs = options.timeoutMs ?? 60_000;

  return new Promise<PrismaCommandResult>((resolveResult) => {
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    let child: ChildProcess;
    try {
      // `shell: false` is the default for spawn() — we pass argv as an
      // array so the user-supplied migration name (already validated)
      // never touches a shell.
      child = spawn("bunx", ["--bun", "prisma", ...args], {
        cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
    } catch (err) {
      resolveResult({
        success: false,
        stdout: "",
        stderr: String(err instanceof Error ? err.message : err),
        code: -1,
      });
      return;
    }

    if (child.stdout) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* already exited */
        }
      }, timeoutMs);
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolveResult({
        success: false,
        stdout,
        stderr: stderr + String(err.message ?? err),
        code: -1,
      });
    });
    child.on("exit", (code) => {
      if (timer) clearTimeout(timer);
      resolveResult({
        success: code === 0,
        stdout,
        stderr,
        code: code ?? -1,
      });
    });
  });
}

/**
 * Run `prisma migrate deploy`. Applies every pending migration in
 * timestamp order. Idempotent — already-applied migrations are
 * skipped by the CLI itself.
 */
export function runMigrateDeploy(
  projectRoot: string = process.cwd(),
): Promise<PrismaCommandResult> {
  return runPrismaCommand(["migrate", "deploy"], { projectRoot, timeoutMs: 120_000 });
}

/**
 * Run `prisma migrate dev --create-only --name <name>`. Generates the
 * SQL diff against the live database without applying it. Returns the
 * generated SQL as a convenience.
 *
 * We pass `--skip-generate` to avoid re-running `prisma generate` during
 * an interactive create — the dev server already has a watcher.
 */
export async function runCreateMigration(
  name: string,
  projectRoot: string = process.cwd(),
): Promise<PrismaCommandResult & { sql?: string; folder?: string }> {
  validateMigrationName(name);
  const before = listDiskMigrations(projectRoot).map((m) => m.name);
  const result = await runPrismaCommand(
    ["migrate", "dev", "--create-only", "--skip-generate", "--name", name],
    { projectRoot, timeoutMs: 60_000 },
  );
  if (!result.success) return result;
  const after = listDiskMigrations(projectRoot).map((m) => m.name);
  const created = after.find((n) => !before.includes(n));
  if (!created) return result;
  let sql: string | undefined;
  try {
    sql = readMigrationSql(projectRoot, created);
  } catch {
    sql = undefined;
  }
  return { ...result, folder: created, sql };
}

/**
 * Mark a failed migration as rolled-back so the next `deploy` retries it.
 * Wraps `prisma migrate resolve --rolled-back <name>`.
 */
export function runResolveRolledBack(
  name: string,
  projectRoot: string = process.cwd(),
): Promise<PrismaCommandResult> {
  validateMigrationName(name) as never; // strict-mode safety
  if (!isValidDiskMigrationName(name)) {
    throw new Error(`runResolveRolledBack expects a disk migration name, got "${name}"`);
  }
  return runPrismaCommand(["migrate", "resolve", "--rolled-back", name], {
    projectRoot,
    timeoutMs: 30_000,
  });
}

/**
 * Run a migration's SQL inside a transaction and roll back at the end.
 * Lets the operator see whether the SQL parses + executes against a
 * clean transaction without committing the change.
 *
 * Returns `{ success, error? }` — successful runs always end in a
 * rollback (which is the intent), so we never persist anything.
 */
export async function runDryRunMigration(
  prisma: PrismaService,
  projectRoot: string,
  name: string,
): Promise<{ success: boolean; error?: string }> {
  if (!isValidDiskMigrationName(name)) {
    throw new Error(`runDryRunMigration expects a disk migration name, got "${name}"`);
  }
  const sql = readMigrationSql(projectRoot, name);
  try {
    await prisma.$transaction(async (tx) => {
      // Prisma's executeRawUnsafe runs DDL inside the same transaction
      // (Postgres supports transactional DDL). We deliberately throw
      // at the end so the transaction rolls back — see below.
      const statements = splitSqlStatements(sql);
      for (const stmt of statements) {
        if (!stmt.trim()) continue;
        await tx.$executeRawUnsafe(stmt);
      }
      throw new DryRunRollback();
    });
    // Should never reach here — DryRunRollback always fires.
    return { success: false, error: "dry-run did not roll back as expected" };
  } catch (err) {
    if (err instanceof DryRunRollback) {
      return { success: true };
    }
    return { success: false, error: String(err instanceof Error ? err.message : err) };
  }
}

class DryRunRollback extends Error {
  constructor() {
    super("intentional dry-run rollback");
  }
}

/**
 * Naive but adequate SQL splitter. Prisma's generated migration files
 * use `;` as a statement separator and have no PL/pgSQL bodies (which
 * would contain unquoted semicolons). The dry-run path is best-effort;
 * the real apply path uses `prisma migrate deploy` which has its own
 * parser.
 *
 * Exported for unit tests; production callers go through
 * `runDryRunMigration`.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let inString = false;
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (!inDollar && ch === "'" && sql[i - 1] !== "\\") inString = !inString;
    if (!inString && ch === "$" && sql[i + 1] === "$") {
      inDollar = !inDollar;
      current += "$$";
      i++;
      continue;
    }
    if (!inString && !inDollar && ch === ";") {
      if (current.trim()) out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}
