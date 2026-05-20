import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · PostGIS extension migration.
 *
 * The Geo feature needs PostGIS available before the geo schema can
 * declare `Unsupported("geometry(...)")` columns. The raw-SQL
 * migration is feature-gated and lives under
 * `prisma/features/geo/migrations/<dir>/migration.sql` — it is only
 * materialised into `prisma/migrations/` by `bun run prepare:schema`
 * when `features.geo.enabled === true`.
 *
 * The test pins the source location + the load-bearing SQL so a
 * future cleanup can't drop it (consumers turning Geo on must hit an
 * idempotent CREATE EXTENSION).
 */
describe("Story · PostGIS extension migration", () => {
  function findPostGisMigration(): { dir: string; sql: string } {
    const featureMigrations = resolve(ROOT, "prisma/features/geo/migrations");
    expect(existsSync(featureMigrations), `${featureMigrations} must exist`).toBe(true);
    const candidates = readdirSync(featureMigrations).filter((entry) => /postgis/i.test(entry));
    expect(candidates.length, "a postgis migration must exist").toBeGreaterThan(0);
    const dir = resolve(featureMigrations, candidates[0]!);
    const sqlPath = resolve(dir, "migration.sql");
    expect(existsSync(sqlPath), `${sqlPath} must exist`).toBe(true);
    return { dir, sql: readFileSync(sqlPath, "utf8") };
  }

  it("contains an idempotent CREATE EXTENSION for PostGIS", () => {
    const { sql } = findPostGisMigration();
    expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+postgis/i);
  });

  it("runs after the foundational pg_uuidv7 migration (timestamp ordering)", () => {
    const { dir } = findPostGisMigration();
    const dirName = dir.split("/").pop()!;
    expect(dirName.localeCompare("20260428000000_pg_uuidv7")).toBeGreaterThan(0);
  });

  it("does NOT drop or modify other extensions (idempotent + non-destructive)", () => {
    const { sql } = findPostGisMigration();
    expect(sql).not.toMatch(/DROP\s+EXTENSION/i);
    expect(sql).not.toMatch(/ALTER\s+EXTENSION/i);
  });

  it("keeps a canonical copy under prisma/features/geo/migrations", () => {
    const featureMigrations = resolve(ROOT, "prisma/features/geo/migrations");
    const featureCandidates = readdirSync(featureMigrations).filter((entry) =>
      /postgis/i.test(entry),
    );
    expect(featureCandidates.length).toBeGreaterThan(0);
  });

  it("when geo schema is prepared into always-on, postgis precedes geo_schema", () => {
    const alwaysOn = resolve(ROOT, "prisma/migrations");
    const postgis = readdirSync(alwaysOn).filter((entry) => /postgis/i.test(entry));
    const geoSchema = readdirSync(alwaysOn).filter((entry) => /geo_schema/i.test(entry));
    if (geoSchema.length === 0) {
      expect(postgis.length).toBe(0);
      return;
    }
    expect(postgis.length).toBeGreaterThan(0);
    expect(postgis[0]!.localeCompare(geoSchema[0]!)).toBeLessThan(0);
  });

  it("does not commit geo migrations into always-on prisma/migrations (CI geo-off)", () => {
    const featureMigrations = resolve(ROOT, "prisma/features/geo/migrations");
    const geoNames = readdirSync(featureMigrations);
    const git = spawnSync("git", ["ls-files", "prisma/migrations"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(git.status).toBe(0);
    const committed = [
      ...new Set(
        (git.stdout ?? "")
          .split("\n")
          .map((line) => /prisma\/migrations\/([^/]+)\//.exec(line)?.[1])
          .filter((name): name is string => !!name && name !== "migration_lock.toml"),
      ),
    ];
    for (const name of geoNames) {
      expect(committed, `${name} must stay feature-gated`).not.toContain(name);
    }
  });
});
