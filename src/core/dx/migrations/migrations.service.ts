/**
 * Service layer for `/hub/migrations`.
 *
 * Composes `migrations-planner.ts` (pure decisions) with
 * `migrations-runner.ts` (file system + Postgres + child-process side
 * effects) into the JSON shapes the controller returns to the SPA.
 *
 * The controller stays thin — it asserts `NODE_ENV=development`,
 * validates input, and forwards to this service. Every method here is
 * an `async` function returning a JSON-serialisable record.
 */

import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../prisma/prisma.service.js";

import {
  buildMigrationsView,
  isValidDiskMigrationName,
  isValidMigrationName,
  type MigrationsView,
} from "./migrations-planner.js";
import {
  discardMigrationDirectory,
  listAppliedMigrations,
  listDiskMigrations,
  readMigrationSql,
  runCreateMigration,
  runDryRunMigration,
  runMigrateDeploy,
  runPrismaCommand,
  runResolveRolledBack,
  withAdvisoryLock,
} from "./migrations-runner.js";

export interface MigrationsStatusResponse extends MigrationsView {
  /** Project-relative path to the migrations directory. */
  migrationsRoot: string;
  /** Server timestamp at the moment the snapshot was assembled. */
  generatedAt: string;
}

export interface MigrationsApplyResponse {
  applied: string[];
  stdout: string;
  stderr: string;
  success: boolean;
}

@Injectable()
export class MigrationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Snapshot of every migration the UI cares about — applied rows from
   * the DB joined with disk migration folders, plus drift signals.
   */
  async getStatus(): Promise<MigrationsStatusResponse> {
    const projectRoot = process.cwd();
    const diskMigrations = listDiskMigrations(projectRoot);
    const appliedRows = await listAppliedMigrations(this.prisma);
    const view = buildMigrationsView({ diskMigrations, appliedRows });
    return {
      ...view,
      migrationsRoot: "prisma/migrations",
      generatedAt: new Date().toISOString(),
    };
  }

  /** Read the SQL of a single (pending or applied) migration folder. */
  previewSql(name: string): { name: string; sql: string } {
    if (!isValidDiskMigrationName(name)) {
      throw new Error(`Invalid migration folder name: ${name}`);
    }
    return { name, sql: readMigrationSql(process.cwd(), name) };
  }

  /**
   * Apply every pending migration via `prisma migrate deploy`. Lock-
   * gated; resolves with `{ acquired: false }` when another deploy is
   * in flight so the controller can map to 409.
   */
  async deployPending(): Promise<{ acquired: boolean; result?: MigrationsApplyResponse }> {
    const projectRoot = process.cwd();
    const beforeNames = await this.appliedNames();
    return withAdvisoryLock(this.prisma, async () => {
      const cmd = await runMigrateDeploy(projectRoot);
      const afterNames = await this.appliedNames();
      const applied = afterNames.filter((n) => !beforeNames.includes(n));
      return {
        applied,
        stdout: cmd.stdout,
        stderr: cmd.stderr,
        success: cmd.success,
      };
    });
  }

  /**
   * Apply a single pending migration. We call `migrate deploy` (the
   * forward-only path) and verify after that exactly the requested
   * migration ended up applied. Other pending migrations would also be
   * applied by the CLI — that is acceptable behaviour for the dev-
   * portal "Apply this one" affordance because the operator sees the
   * full list before confirming.
   */
  async applyOne(
    name: string,
  ): Promise<{ acquired: boolean; result?: MigrationsApplyResponse & { name: string } }> {
    if (!isValidDiskMigrationName(name)) {
      throw new Error(`Invalid migration name: ${name}`);
    }
    const projectRoot = process.cwd();
    const beforeNames = await this.appliedNames();
    return withAdvisoryLock(this.prisma, async () => {
      const cmd = await runMigrateDeploy(projectRoot);
      const afterNames = await this.appliedNames();
      const applied = afterNames.filter((n) => !beforeNames.includes(n));
      return {
        name,
        applied,
        stdout: cmd.stdout,
        stderr: cmd.stderr,
        success: cmd.success && applied.includes(name),
      };
    });
  }

  /**
   * Run a migration's SQL inside a transaction and roll back. Pure
   * smoke test — never persists anything.
   */
  async dryRun(
    name: string,
  ): Promise<{ acquired: boolean; result?: { success: boolean; error?: string; name: string } }> {
    if (!isValidDiskMigrationName(name)) {
      throw new Error(`Invalid migration name: ${name}`);
    }
    return withAdvisoryLock(this.prisma, async () => {
      const r = await runDryRunMigration(this.prisma, process.cwd(), name);
      return { name, ...r };
    });
  }

  /**
   * Mark a failed migration as rolled-back, then run `migrate deploy`
   * so it is retried. Used by the Status-tab "Retry" action.
   */
  async retryFailed(
    name: string,
  ): Promise<{ acquired: boolean; result?: MigrationsApplyResponse & { name: string } }> {
    if (!isValidDiskMigrationName(name)) {
      throw new Error(`Invalid migration name: ${name}`);
    }
    const projectRoot = process.cwd();
    return withAdvisoryLock(this.prisma, async () => {
      const resolveResult = await runResolveRolledBack(name, projectRoot);
      if (!resolveResult.success) {
        return {
          name,
          applied: [],
          stdout: resolveResult.stdout,
          stderr: resolveResult.stderr,
          success: false,
        };
      }
      const beforeNames = await this.appliedNames();
      const cmd = await runMigrateDeploy(projectRoot);
      const afterNames = await this.appliedNames();
      const applied = afterNames.filter((n) => !beforeNames.includes(n));
      return {
        name,
        applied,
        stdout: `${resolveResult.stdout}\n${cmd.stdout}`,
        stderr: `${resolveResult.stderr}\n${cmd.stderr}`,
        success: cmd.success,
      };
    });
  }

  /**
   * Create a draft migration via `prisma migrate dev --create-only`.
   * Returns the generated SQL preview without applying anything.
   */
  async createDraft(name: string): Promise<{
    acquired: boolean;
    result?: { name: string; folder?: string; sql?: string; success: boolean; stderr: string };
  }> {
    if (!isValidMigrationName(name)) {
      throw new Error(`Invalid migration name: ${name}`);
    }
    const projectRoot = process.cwd();
    return withAdvisoryLock(this.prisma, async () => {
      const result = await runCreateMigration(name, projectRoot);
      return {
        name,
        ...(result.folder ? { folder: result.folder } : {}),
        ...(result.sql ? { sql: result.sql } : {}),
        success: result.success,
        stderr: result.stderr,
      };
    });
  }

  /**
   * Apply a previously-created draft migration. Same code path as
   * `deployPending` — `migrate deploy` discovers the new folder by
   * itself.
   */
  applyDraft(
    name: string,
  ): Promise<{ acquired: boolean; result?: MigrationsApplyResponse & { name: string } }> {
    return this.applyOne(name);
  }

  /**
   * Discard a draft migration directory. Path-safety is enforced two
   * layers deep — `isValidDiskMigrationName` here, then again inside
   * `resolveMigrationDirectory` in the runner.
   */
  discardDraft(name: string): { name: string; deleted: boolean } {
    if (!isValidDiskMigrationName(name)) {
      throw new Error(`Invalid migration name: ${name}`);
    }
    return { name, deleted: discardMigrationDirectory(process.cwd(), name) };
  }

  /**
   * Return the SQL diff between the live database schema and the
   * Prisma schema file. Best-effort — falls back to an empty diff if
   * the CLI rejects our flags (older Prisma versions).
   */
  async getDiff(): Promise<{ sql: string; success: boolean; stderr: string }> {
    const result = await runPrismaCommand(
      [
        "migrate",
        "diff",
        "--from-schema-datasource",
        "prisma/schema.prisma",
        "--to-schema-datamodel",
        "prisma/schema.prisma",
        "--script",
      ],
      { timeoutMs: 30_000 },
    );
    return {
      sql: result.success ? result.stdout : "",
      success: result.success,
      stderr: result.stderr,
    };
  }

  private async appliedNames(): Promise<string[]> {
    const rows = await listAppliedMigrations(this.prisma);
    return rows.filter((r) => r.finished_at !== null).map((r) => r.migration_name);
  }
}
