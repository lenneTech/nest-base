import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · PowerSync replication role + publication.
 *
 * PowerSync needs a dedicated Postgres role with the `REPLICATION`
 * attribute and a logical publication that lists every synced table.
 * Both ship as a raw-SQL migration so the bootstrap works on a fresh
 * database the first time the WAL decoder connects.
 *
 * Test asserts the migration:
 *   - creates the role with REPLICATION (and LOGIN so the connector can log in)
 *   - creates a publication PowerSync targets by name
 *   - the publication includes the synced tables
 *   - re-running the migration is idempotent (no DROP, IF NOT EXISTS)
 */
describe("Story · PowerSync replication role + publication", () => {
  function readPowerSyncMigration(): string {
    const migrationsDir = resolve(ROOT, "prisma/migrations");
    const candidates = readdirSync(migrationsDir).filter((entry) =>
      /powersync|replication/i.test(entry),
    );
    expect(candidates.length, "a PowerSync replication migration must exist").toBeGreaterThan(0);
    const sqlPath = resolve(migrationsDir, candidates[0]!, "migration.sql");
    expect(existsSync(sqlPath), `${sqlPath} must exist`).toBe(true);
    return readFileSync(sqlPath, "utf8");
  }

  it("creates a powersync role with REPLICATION + LOGIN", () => {
    const sql = readPowerSyncMigration();
    expect(sql).toMatch(/CREATE\s+ROLE[\s\S]*?powersync/i);
    expect(sql).toMatch(/REPLICATION/i);
    expect(sql).toMatch(/LOGIN/i);
  });

  it("creates a publication PowerSync subscribes to", () => {
    const sql = readPowerSyncMigration();
    expect(sql).toMatch(/CREATE\s+PUBLICATION\s+powersync/i);
  });

  it("publication includes the user table (sync target)", () => {
    const sql = readPowerSyncMigration();
    expect(sql).toMatch(
      /PUBLICATION\s+powersync[\s\S]*?(FOR\s+ALL\s+TABLES|FOR\s+TABLE[\s\S]*?users?)/i,
    );
  });

  it("idempotent: re-running the migration is safe (no plain CREATE that will collide)", () => {
    const sql = readPowerSyncMigration();
    // Either guarded with DO $$ BEGIN ... EXCEPTION blocks, or IF NOT EXISTS / pg_roles guard.
    expect(sql).toMatch(/IF\s+NOT\s+EXISTS|pg_roles|EXCEPTION\s+WHEN\s+duplicate/i);
  });

  it("does not drop existing roles or publications", () => {
    const sql = readPowerSyncMigration();
    expect(sql).not.toMatch(/DROP\s+ROLE/i);
    expect(sql).not.toMatch(/DROP\s+PUBLICATION/i);
  });

  it("grants SELECT to the powersync role on the published tables", () => {
    const sql = readPowerSyncMigration();
    expect(sql).toMatch(/GRANT\s+SELECT[\s\S]*?TO\s+powersync/i);
  });
});
