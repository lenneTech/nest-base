import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isUuidV7, uuidV7 } from "../../src/core/uuid/uuid-v7.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * UUID v7 setup (PLAN.md §31 — datamodel skeleton; uses pg_uuidv7).
 *
 * Two layers:
 *   - Application-side generator (`uuidV7()`) — used wherever the DB is
 *     not in scope (logs, request-id, tests). Pure crypto + clock.
 *   - Database-side generator via the `pg_uuidv7` Postgres extension —
 *     loaded via a Prisma migration; columns set their default to
 *     `uuid_generate_v7()`. Fully decoupled from Node so DB-only inserts
 *     keep producing time-ordered UUIDs.
 */
describe("UUID v7", () => {
  describe("uuidV7() generator", () => {
    it("produces a v7 UUID with version=7 and RFC4122 variant bits", () => {
      const id = uuidV7();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it("produces unique values", () => {
      const set = new Set<string>();
      for (let i = 0; i < 50; i++) set.add(uuidV7());
      expect(set.size).toBe(50);
    });

    it("encodes the current millisecond timestamp in the leading 48 bits (time-ordered)", () => {
      const before = Date.now();
      const id = uuidV7();
      const after = Date.now();

      const tsHex = id.replaceAll("-", "").slice(0, 12);
      const ts = Number(BigInt("0x" + tsHex));
      expect(ts).toBeGreaterThanOrEqual(before - 5);
      expect(ts).toBeLessThanOrEqual(after + 5);
    });

    it("is monotonic across consecutive calls at the timestamp resolution", () => {
      // The 48-bit timestamp prefix is non-decreasing across calls; the
      // random suffix may flip ordering for two UUIDs minted in the same
      // millisecond, so we compare only the time-bytes.
      const tsOf = (u: string): bigint => BigInt("0x" + u.replaceAll("-", "").slice(0, 12));
      const a = tsOf(uuidV7());
      const b = tsOf(uuidV7());
      expect(b >= a).toBe(true);
    });
  });

  describe("isUuidV7()", () => {
    it("accepts a valid v7 UUID", () => {
      expect(isUuidV7(uuidV7())).toBe(true);
    });

    it("rejects a v4 UUID", () => {
      expect(isUuidV7("a4b6f8e2-1c2d-4f5a-8b9c-0d1e2f3a4b5c")).toBe(false);
    });

    it("rejects malformed inputs", () => {
      expect(isUuidV7("")).toBe(false);
      expect(isUuidV7("not-a-uuid")).toBe(false);
      expect(isUuidV7("00000000-0000-7000-8000-000000000000")).toBe(true);
    });
  });

  describe("Prisma migration installs pg_uuidv7", () => {
    const MIGRATIONS = resolve(ROOT, "prisma/migrations");

    it("a migration directory exists for pg_uuidv7 setup", () => {
      expect(existsSync(MIGRATIONS)).toBe(true);
      const dirs = readdirSync(MIGRATIONS);
      const setup = dirs.find((d) => /pg_uuidv7|uuid_v7/i.test(d));
      expect(setup, `no migration matching /pg_uuidv7|uuid_v7/ in prisma/migrations`).toBeDefined();
    });

    it("the migration creates the extension idempotently", () => {
      const dirs = readdirSync(MIGRATIONS).filter((d) => /pg_uuidv7|uuid_v7/i.test(d));
      const sqlPath = resolve(MIGRATIONS, dirs[0]!, "migration.sql");
      const sql = readFileSync(sqlPath, "utf8");
      expect(sql).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+pg_uuidv7/i);
    });
  });
});
