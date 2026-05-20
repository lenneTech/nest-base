import { describe, expect, it } from "vitest";

import {
  ADVISORY_LOCK_KEY,
  buildMigrationsView,
  isValidMigrationName,
  parsePrismaMigrationStatus,
  resolveMigrationDirectory,
  validateMigrationName,
  type AppliedMigrationRow,
} from "../../src/core/dx/migrations/migrations-planner.js";

/**
 * Story · `/hub/migrations` planner (Issue #10).
 *
 * Pure functions only — file IO and database queries belong in the
 * runner. The planner is the contract the controller / story-tests /
 * UI all share.
 */

describe("Story · parsePrismaMigrationStatus", () => {
  it("parses an up-to-date status output", () => {
    const stdout = `Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database
3 migrations found in prisma/migrations
Database schema is up to date!`;
    const parsed = parsePrismaMigrationStatus(stdout);
    expect(parsed.foundCount).toBe(3);
    expect(parsed.upToDate).toBe(true);
    expect(parsed.driftDetected).toBe(false);
    expect(parsed.pendingNames).toEqual([]);
  });

  it("collects pending migration names from a not-applied list", () => {
    const stdout = `Prisma schema loaded from prisma/schema.prisma
2 migrations found in prisma/migrations
Following migration have not yet been applied:
20260101000000_alpha
20260101000100_beta
To apply migrations in development run prisma migrate dev.`;
    const parsed = parsePrismaMigrationStatus(stdout);
    expect(parsed.pendingNames).toEqual(["20260101000000_alpha", "20260101000100_beta"]);
    expect(parsed.upToDate).toBe(false);
  });

  it("flags drift when the CLI reports a database schema drift", () => {
    const stdout = `Drift detected: Your database schema is not in sync with your migration history.
The following is a summary of the differences:
[+] Added tables: foo`;
    const parsed = parsePrismaMigrationStatus(stdout);
    expect(parsed.driftDetected).toBe(true);
  });

  it("returns sane defaults for empty input", () => {
    const parsed = parsePrismaMigrationStatus("");
    expect(parsed.foundCount).toBe(0);
    expect(parsed.upToDate).toBe(false);
    expect(parsed.driftDetected).toBe(false);
    expect(parsed.pendingNames).toEqual([]);
  });
});

describe("Story · validateMigrationName", () => {
  it("accepts kebab-case names between 3 and 50 chars", () => {
    expect(isValidMigrationName("add-user-table")).toBe(true);
    expect(isValidMigrationName("foo")).toBe(true);
    expect(isValidMigrationName("a".repeat(50))).toBe(true);
  });

  it("rejects names with path-traversal patterns", () => {
    expect(isValidMigrationName("../../../etc/passwd")).toBe(false);
    expect(isValidMigrationName("..")).toBe(false);
    expect(isValidMigrationName("foo/bar")).toBe(false);
    expect(isValidMigrationName("foo\\bar")).toBe(false);
  });

  it("rejects empty / too-short / too-long names", () => {
    expect(isValidMigrationName("")).toBe(false);
    expect(isValidMigrationName("ab")).toBe(false);
    expect(isValidMigrationName("a".repeat(51))).toBe(false);
  });

  it("rejects names with capitals or spaces or special chars", () => {
    expect(isValidMigrationName("AddUserTable")).toBe(false);
    expect(isValidMigrationName("add user")).toBe(false);
    expect(isValidMigrationName("add_user")).toBe(false);
    expect(isValidMigrationName("add-user!")).toBe(false);
  });

  it("validateMigrationName throws with a detailed message on bad input", () => {
    expect(() => validateMigrationName("../../etc")).toThrow(/migration name/i);
    expect(() => validateMigrationName("ok-name")).not.toThrow();
  });
});

describe("Story · resolveMigrationDirectory", () => {
  it("returns an absolute path within the migrations root", () => {
    const root = "/tmp/project";
    const resolved = resolveMigrationDirectory(root, "20260101000000_alpha");
    expect(resolved).toBe("/tmp/project/prisma/migrations/20260101000000_alpha");
  });

  it("rejects names that would escape the migrations root", () => {
    expect(() => resolveMigrationDirectory("/tmp/project", "../escape")).toThrow();
    expect(() => resolveMigrationDirectory("/tmp/project", "foo/bar")).toThrow();
  });
});

describe("Story · buildMigrationsView", () => {
  const baseApplied: AppliedMigrationRow[] = [
    {
      id: "1",
      migration_name: "20260101000000_alpha",
      started_at: new Date("2026-01-01T00:00:00Z").toISOString(),
      finished_at: new Date("2026-01-01T00:00:01Z").toISOString(),
      applied_steps_count: 1,
      logs: null,
      rolled_back_at: null,
    },
    {
      id: "2",
      migration_name: "20260101000100_beta",
      started_at: new Date("2026-01-01T00:01:00Z").toISOString(),
      finished_at: new Date("2026-01-01T00:01:01Z").toISOString(),
      applied_steps_count: 1,
      logs: null,
      rolled_back_at: null,
    },
  ];

  it("partitions applied and pending migrations by directory contents", () => {
    const view = buildMigrationsView({
      diskMigrations: [
        { name: "20260101000000_alpha" },
        { name: "20260101000100_beta" },
        { name: "20260101000200_gamma" },
      ],
      appliedRows: baseApplied,
    });
    expect(view.applied.map((m) => m.migration_name)).toEqual([
      "20260101000000_alpha",
      "20260101000100_beta",
    ]);
    expect(view.pending.map((m) => m.name)).toEqual(["20260101000200_gamma"]);
    expect(view.driftDetected).toBe(false);
  });

  it("flags failed rows when finished_at is null and no rollback", () => {
    const failed: AppliedMigrationRow = {
      id: "3",
      migration_name: "20260101000200_gamma",
      started_at: new Date("2026-01-01T00:02:00Z").toISOString(),
      finished_at: null,
      applied_steps_count: 0,
      logs: "syntax error near GRANT",
      rolled_back_at: null,
    };
    const view = buildMigrationsView({
      diskMigrations: [{ name: "20260101000200_gamma" }],
      appliedRows: [failed],
    });
    expect(view.failed.map((m) => m.migration_name)).toEqual(["20260101000200_gamma"]);
    // A failed row should not also appear in `applied`
    expect(view.applied).toEqual([]);
    expect(view.pending).toEqual([]);
  });

  it("flags drift when an applied migration is missing from disk", () => {
    const view = buildMigrationsView({
      diskMigrations: [{ name: "20260101000000_alpha" }],
      appliedRows: baseApplied,
    });
    expect(view.driftDetected).toBe(true);
    expect(view.driftReasons).toContain(
      "Migration applied in DB but missing on disk: 20260101000100_beta",
    );
  });

  it("returns no pending migrations when disk is empty but DB has rows", () => {
    const view = buildMigrationsView({
      diskMigrations: [],
      appliedRows: baseApplied,
    });
    expect(view.pending).toEqual([]);
    expect(view.driftDetected).toBe(true);
  });

  it("orders pending migrations lexicographically (timestamp prefix)", () => {
    const view = buildMigrationsView({
      diskMigrations: [
        { name: "20260101000200_gamma" },
        { name: "20260101000000_alpha" },
        { name: "20260101000100_beta" },
      ],
      appliedRows: [],
    });
    expect(view.pending.map((m) => m.name)).toEqual([
      "20260101000000_alpha",
      "20260101000100_beta",
      "20260101000200_gamma",
    ]);
  });
});

describe("Story · advisory lock key", () => {
  it("exposes a stable bigint key in the safe range", () => {
    expect(typeof ADVISORY_LOCK_KEY).toBe("bigint");
    // Postgres advisory keys are bigint; we keep ours small + unique
    expect(ADVISORY_LOCK_KEY).toBeGreaterThan(0n);
  });
});
