/**
 * Pure planner for `/hub/migrations` (Issue #10).
 *
 * I/O-free helpers shared by the controller, story tests, and React
 * page. The runner half (`migrations-runner.ts`) wraps these with file
 * system + Prisma queries + child-process spawns.
 *
 * Surface:
 *   - parsePrismaMigrationStatus(stdout)  — `prisma migrate status` text
 *   - validateMigrationName(name)         — kebab-case + length + path-safe
 *   - resolveMigrationDirectory(root, n)  — safe path join under
 *                                           `prisma/migrations/`
 *   - buildMigrationsView({ disk, applied }) — UI shape (status + drift)
 *
 * Discipline: every decision the UI surfaces (is this migration
 * pending? is the schema drifting?) must be expressible as a function
 * of structured input. Spawning `prisma migrate deploy` lives in the
 * runner; whether to spawn it is decided here.
 */

import { resolve } from "node:path";

/**
 * Postgres advisory lock key shared by every executing migration
 * endpoint. The number is arbitrary but stable — a different process
 * trying to grab the same key sees `pg_try_advisory_lock(...)` return
 * `false` and we respond with 409.
 *
 * Picked from a high-entropy region to avoid colliding with any other
 * advisory locks Prisma or future tooling might use.
 */
export const ADVISORY_LOCK_KEY: bigint = 0x6e73625f6d696772n; // ASCII "nsb_migr"

/**
 * User-supplied migration name regex — strict kebab-case for
 * Create-New flow. Prisma will prepend a 14-digit timestamp itself,
 * so the user only types the suffix.
 */
const USER_NAME_RE = /^[a-z][a-z0-9-]{2,49}$/;

/**
 * Disk migration folder regex — accepts the `<timestamp>_<suffix>`
 * shape Prisma emits. Used by `resolveMigrationDirectory` so callers
 * can address an existing folder whose timestamp prefix the user
 * never typed.
 */
const DISK_NAME_RE = /^\d{14}_[a-z][a-z0-9_-]{1,80}$/i;

export function isValidMigrationName(name: string): boolean {
  if (typeof name !== "string") return false;
  if (!USER_NAME_RE.test(name)) return false;
  // Cheap belt-and-braces — the regex already excludes these but spelling
  // them out keeps the audit trail obvious for reviewers.
  if (name.includes("..")) return false;
  if (name.includes("/")) return false;
  if (name.includes("\\")) return false;
  return true;
}

export function validateMigrationName(name: string): void {
  if (!isValidMigrationName(name)) {
    throw new Error(
      `Invalid migration name: "${name}". Use kebab-case ` +
        "(3-50 chars, lowercase letters / digits / dashes, must start with a letter).",
    );
  }
}

/**
 * Path-safe predicate for migration *folder* names that already exist
 * on disk (Prisma prefixes them with a timestamp). Strictly stricter
 * than `node:path.resolve` — even a normalised name that escapes the
 * sandbox is rejected here.
 */
export function isValidDiskMigrationName(name: string): boolean {
  if (typeof name !== "string") return false;
  if (!DISK_NAME_RE.test(name)) return false;
  if (name.includes("..")) return false;
  if (name.includes("/")) return false;
  if (name.includes("\\")) return false;
  return true;
}

/**
 * Resolve a migration *folder* path under `prisma/migrations/`. Refuses
 * to return paths that escape the migrations root via traversal — the
 * defense-in-depth check is doubled with the disk-name regex so a
 * caller has to bypass two gates to write outside the sandbox.
 */
export function resolveMigrationDirectory(projectRoot: string, name: string): string {
  if (!isValidDiskMigrationName(name) && !isValidMigrationName(name)) {
    throw new Error(`Refusing to resolve migration directory: invalid name "${name}"`);
  }
  const root = resolve(projectRoot, "prisma", "migrations");
  const target = resolve(root, name);
  if (!target.startsWith(`${root}/`) && target !== root) {
    throw new Error(`Refusing to resolve migration directory outside the sandbox: ${name}`);
  }
  return target;
}

export interface PrismaMigrationStatus {
  /** Total migration files discovered in `prisma/migrations/`. */
  foundCount: number;
  /** True when stdout contains the "up to date" sentinel. */
  upToDate: boolean;
  /** True when stdout contains the drift-detection sentinel. */
  driftDetected: boolean;
  /** Names of migrations the CLI lists as not-yet-applied. */
  pendingNames: string[];
}

/**
 * Parse the text output of `prisma migrate status`. The CLI is not
 * machine-readable on every line, so we look for the well-known
 * sentinels Prisma has emitted since v4 and tolerate everything else.
 *
 * Note: when `--json` is available we prefer that path in the runner;
 * this parser exists for environments where the JSON flag is not
 * supported (older CLI) and as a sanity check on top of the JSON.
 */
export function parsePrismaMigrationStatus(stdout: string): PrismaMigrationStatus {
  const text = stdout ?? "";
  const lines = text.split(/\r?\n/);

  let foundCount = 0;
  const foundMatch = text.match(/(\d+)\s+migrations?\s+found\s+in/i);
  if (foundMatch) foundCount = Number.parseInt(foundMatch[1] ?? "0", 10) || 0;

  const upToDate = /Database\s+schema\s+is\s+up\s+to\s+date/i.test(text);
  const driftDetected = /Drift\s+detected/i.test(text);

  const pendingNames: string[] = [];
  // Prisma prints a header followed by one migration name per line:
  //   "Following migration have not yet been applied:"
  //   "20260101000000_alpha"
  //   "20260101000100_beta"
  // We collect names until we hit either an empty line or a line that
  // looks like prose (starts with a capital letter and contains a space).
  let collecting = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      collecting = false;
      continue;
    }
    if (
      /following\s+migrations?\s+have\s+not\s+yet\s+been\s+applied/i.test(line) ||
      /the\s+following\s+migrations?\s+have\s+not\s+yet\s+been\s+applied/i.test(line)
    ) {
      collecting = true;
      continue;
    }
    if (collecting) {
      // A migration name is a timestamp-prefixed kebab-case folder.
      if (/^\d{14}_[a-z0-9_-]+$/i.test(line)) {
        pendingNames.push(line);
      } else {
        collecting = false;
      }
    }
  }

  return { foundCount, upToDate, driftDetected, pendingNames };
}

/** A row from Postgres' `_prisma_migrations` table (subset we use). */
export interface AppliedMigrationRow {
  id: string;
  migration_name: string;
  /** ISO timestamp string. */
  started_at: string;
  /** ISO timestamp string. Null on a failed / running migration. */
  finished_at: string | null;
  applied_steps_count: number;
  /** CLI / Prisma engine error logs. */
  logs: string | null;
  /** ISO timestamp; null on healthy / failed-but-unresolved rows. */
  rolled_back_at: string | null;
}

export interface DiskMigration {
  name: string;
}

export interface PendingMigration {
  name: string;
}

export interface FailedMigration extends AppliedMigrationRow {
  /** Convenience flag — true when `finished_at` is null and not rolled back. */
  failed: true;
}

export interface MigrationsViewInput {
  diskMigrations: DiskMigration[];
  appliedRows: AppliedMigrationRow[];
}

export interface MigrationsView {
  /** Successfully applied (finished_at non-null, no rollback). */
  applied: AppliedMigrationRow[];
  /** Files on disk that have no matching applied row. */
  pending: PendingMigration[];
  /** DB rows where finished_at is null — the CLI choked mid-deploy. */
  failed: FailedMigration[];
  /** Schema drift signals (rows applied in DB but missing on disk, …). */
  driftDetected: boolean;
  driftReasons: string[];
}

/**
 * Partition disk migrations + DB rows into the three buckets the UI
 * cares about, plus a drift signal. Sort key: the timestamp prefix
 * Prisma uses for migration folder names.
 */
export function buildMigrationsView(input: MigrationsViewInput): MigrationsView {
  const diskNames = new Set(input.diskMigrations.map((m) => m.name));

  const applied: AppliedMigrationRow[] = [];
  const failed: FailedMigration[] = [];

  for (const row of input.appliedRows) {
    const isFailed = row.finished_at === null && row.rolled_back_at === null;
    if (isFailed) {
      failed.push({ ...row, failed: true });
    } else if (row.rolled_back_at === null) {
      applied.push(row);
    }
  }

  const appliedNames = new Set([
    ...applied.map((r) => r.migration_name),
    ...failed.map((r) => r.migration_name),
  ]);

  const pendingNames = input.diskMigrations
    .map((m) => m.name)
    .filter((name) => !appliedNames.has(name))
    .sort((a, b) => a.localeCompare(b));

  const pending: PendingMigration[] = pendingNames.map((name) => ({ name }));

  // Drift = a row in the DB that references a folder no longer on disk.
  const driftReasons: string[] = [];
  for (const row of input.appliedRows) {
    if (row.rolled_back_at !== null) continue;
    if (!diskNames.has(row.migration_name)) {
      driftReasons.push(`Migration applied in DB but missing on disk: ${row.migration_name}`);
    }
  }

  return {
    applied: applied.sort((a, b) => a.migration_name.localeCompare(b.migration_name)),
    pending,
    failed,
    driftDetected: driftReasons.length > 0,
    driftReasons,
  };
}
