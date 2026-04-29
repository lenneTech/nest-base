import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · GIST indexes for geo (PLAN.md §15 + §32 Phase 5c).
 *
 * Prisma can't declare GIST indexes on `Unsupported(...)` columns,
 * so we ship them as a raw-SQL migration that runs after
 * `prepare:schema` has produced the geo tables.
 */
describe("Story · Geo GIST indexes", () => {
  function readGistMigration(): string {
    const migrationsDir = resolve(ROOT, "prisma/migrations");
    const candidates = readdirSync(migrationsDir).filter(
      (entry) => /gist|geo/i.test(entry) && !/postgis_extension/.test(entry),
    );
    expect(candidates.length, "a geo-gist migration must exist").toBeGreaterThan(0);
    const sqlPath = resolve(migrationsDir, candidates[0]!, "migration.sql");
    expect(existsSync(sqlPath), `${sqlPath} must exist`).toBe(true);
    return readFileSync(sqlPath, "utf8");
  }

  it("creates a GIST index on Address.location", () => {
    const sql = readGistMigration();
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?addresses[\s\S]*?USING\s+GIST[\s\S]*?location/i);
  });

  it("creates a GIST index on Geofence.area", () => {
    const sql = readGistMigration();
    expect(sql).toMatch(/CREATE\s+INDEX[\s\S]*?geofences[\s\S]*?USING\s+GIST[\s\S]*?area/i);
  });

  it("uses IF NOT EXISTS so re-running the migration is safe", () => {
    const sql = readGistMigration();
    const matches = sql.match(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/gi) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("does not drop existing indexes", () => {
    expect(readGistMigration()).not.toMatch(/DROP\s+INDEX/i);
  });
});
