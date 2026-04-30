import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discardMigrationDirectory,
  listDiskMigrations,
  readMigrationSql,
  splitSqlStatements,
} from "../../src/core/dx/migrations/migrations-runner.js";

/**
 * Unit tests for the file-system half of the migrations runner.
 *
 * Exercising real `node:fs` against a temp directory is much faster
 * than booting the full app and gives us per-function coverage of the
 * planner-runner contract without needing Postgres.
 */
describe("Unit · migrations-runner (file-system)", () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(resolve(tmpdir(), "mig-runner-"));
    mkdirSync(resolve(workdir, "prisma", "migrations"), { recursive: true });
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  function seed(name: string, sql: string): void {
    const dir = resolve(workdir, "prisma", "migrations", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, "migration.sql"), sql, "utf8");
  }

  describe("listDiskMigrations", () => {
    it("returns an empty list when the migrations dir does not exist", () => {
      const fresh = mkdtempSync(resolve(tmpdir(), "mig-empty-"));
      try {
        expect(listDiskMigrations(fresh)).toEqual([]);
      } finally {
        rmSync(fresh, { recursive: true, force: true });
      }
    });

    it("lists folders that match the Prisma timestamp prefix shape", () => {
      seed("20260101000000_alpha", "select 1;");
      seed("20260101000100_beta", "select 2;");
      const result = listDiskMigrations(workdir);
      expect(result.map((m) => m.name).sort()).toEqual([
        "20260101000000_alpha",
        "20260101000100_beta",
      ]);
    });

    it("ignores migration_lock.toml + dotfiles + invalid names", () => {
      seed("20260101000000_alpha", "select 1;");
      writeFileSync(
        resolve(workdir, "prisma", "migrations", "migration_lock.toml"),
        'provider = "postgresql"\n',
      );
      writeFileSync(resolve(workdir, "prisma", "migrations", ".DS_Store"), "");
      mkdirSync(resolve(workdir, "prisma", "migrations", "no_timestamp_prefix"));
      const result = listDiskMigrations(workdir);
      expect(result.map((m) => m.name)).toEqual(["20260101000000_alpha"]);
    });
  });

  describe("readMigrationSql", () => {
    it("returns the contents of migration.sql for a known folder", () => {
      seed("20260101000000_alpha", "create table foo();");
      expect(readMigrationSql(workdir, "20260101000000_alpha")).toBe("create table foo();");
    });

    it("throws when migration.sql is missing", () => {
      mkdirSync(resolve(workdir, "prisma", "migrations", "20260101000000_alpha"));
      expect(() => readMigrationSql(workdir, "20260101000000_alpha")).toThrow(/not found/i);
    });

    it("rejects path-traversal names", () => {
      expect(() => readMigrationSql(workdir, "../../etc/passwd")).toThrow();
    });
  });

  describe("discardMigrationDirectory", () => {
    it("removes the folder and reports true", () => {
      seed("20260101000000_alpha", "select 1;");
      const ok = discardMigrationDirectory(workdir, "20260101000000_alpha");
      expect(ok).toBe(true);
      expect(listDiskMigrations(workdir)).toEqual([]);
    });

    it("returns false when the folder does not exist", () => {
      const ok = discardMigrationDirectory(workdir, "20260101000000_alpha");
      expect(ok).toBe(false);
    });

    it("rejects path-traversal names", () => {
      expect(() => discardMigrationDirectory(workdir, "../../etc/passwd")).toThrow();
    });
  });

  describe("splitSqlStatements", () => {
    it("splits on top-level semicolons", () => {
      expect(splitSqlStatements("create table a();\ncreate table b();")).toHaveLength(2);
    });

    it("treats a single statement without trailing semicolon as one item", () => {
      expect(splitSqlStatements("select 1")).toEqual(["select 1"]);
    });

    it("ignores semicolons inside single-quoted strings", () => {
      const out = splitSqlStatements("insert into t (s) values ('a;b');select 1;");
      expect(out).toHaveLength(2);
    });

    it("ignores semicolons inside dollar-quoted bodies", () => {
      const sql =
        "create function f() returns void as $$ begin select 1; select 2; end; $$ language plpgsql;\nselect 1;";
      const out = splitSqlStatements(sql);
      expect(out).toHaveLength(2);
    });

    it("returns an empty array for an empty input", () => {
      expect(splitSqlStatements("")).toEqual([]);
      expect(splitSqlStatements(";\n;\n")).toEqual([]);
    });
  });
});
