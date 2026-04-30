import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · PostGIS extension migration.
 *
 * The Geo feature needs PostGIS available before the geo schema can
 * declare `Unsupported("geometry(...)")` columns. A dedicated raw-SQL
 * migration enables the extension; downstream feature schemas
 * (`prisma/features/geo.prisma`) assume it.
 *
 * The test pins the migration's existence + the load-bearing SQL so
 * a future cleanup can't drop it (consumers turning Geo on must hit
 * an idempotent CREATE EXTENSION).
 */
describe("Story · PostGIS extension migration", () => {
  function findPostGisMigration(): { dir: string; sql: string } {
    const migrationsDir = resolve(ROOT, "prisma/migrations");
    expect(existsSync(migrationsDir), "prisma/migrations must exist").toBe(true);
    const candidates = readdirSync(migrationsDir).filter((entry) => /postgis/i.test(entry));
    expect(candidates.length, "a postgis migration must exist").toBeGreaterThan(0);
    const dir = resolve(migrationsDir, candidates[0]!);
    const sqlPath = resolve(dir, "migration.sql");
    expect(existsSync(sqlPath), `${sqlPath} must exist`).toBe(true);
    return { dir, sql: readFileSync(sqlPath, "utf8") };
  }

  it("contains an idempotent CREATE EXTENSION for PostGIS", () => {
    const { sql } = findPostGisMigration();
    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+postgis/i);
  });

  it("runs after the foundational pg_uuidv7 migration (alphabetical ordering)", () => {
    const { dir } = findPostGisMigration();
    const dirName = dir.split("/").pop()!;
    expect(dirName.localeCompare("20260428000000_pg_uuidv7")).toBeGreaterThan(0);
  });

  it("does NOT drop or modify other extensions (idempotent + non-destructive)", () => {
    const { sql } = findPostGisMigration();
    expect(sql).not.toMatch(/DROP\s+EXTENSION/i);
    expect(sql).not.toMatch(/ALTER\s+EXTENSION/i);
  });
});
