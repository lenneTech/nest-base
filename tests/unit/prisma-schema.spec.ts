import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");

/**
 * Prisma schema v1.
 *
 * Slice deliverable: User / Tenant / Role models with `@@map` (table)
 * and `@map` (column) snake_case mappings. Real foreign-keys + RLS
 * policies land in the multi-tenancy and permissions slices.
 */
describe("Prisma schema v1", () => {
  function blockOf(model: string): string {
    const re = new RegExp(`model\\s+${model}\\s*\\{[\\s\\S]*?\\n\\}`, "m");
    const match = SCHEMA.match(re);
    expect(match, `model ${model} block not found`).not.toBeNull();
    return match![0];
  }

  describe("User model", () => {
    const block = (): string => blockOf("User");

    it("exists and maps to snake_case table `users`", () => {
      expect(block()).toMatch(/@@map\(\s*"users"\s*\)/);
    });

    it("has id (UUID, PK)", () => {
      expect(block()).toMatch(/^\s*id\s+String\s+@id/m);
    });

    it('has unique email column with @map("email")', () => {
      const b = block();
      expect(b).toMatch(/email\s+String\s+@unique/);
    });

    it("has timestamp columns mapped to created_at / updated_at", () => {
      const b = block();
      expect(b).toMatch(/createdAt[\s\S]*@map\(\s*"created_at"\s*\)/);
      expect(b).toMatch(/updatedAt[\s\S]*@map\(\s*"updated_at"\s*\)/);
    });

    it("belongs to a tenant via tenantId mapped to tenant_id", () => {
      const b = block();
      expect(b).toMatch(/tenantId[\s\S]*@map\(\s*"tenant_id"\s*\)/);
    });
  });

  describe("Tenant model", () => {
    const block = (): string => blockOf("Tenant");

    it("exists and maps to snake_case table `tenants`", () => {
      expect(block()).toMatch(/@@map\(\s*"tenants"\s*\)/);
    });

    it("has id and unique name", () => {
      const b = block();
      expect(b).toMatch(/^\s*id\s+String\s+@id/m);
      expect(b).toMatch(/name\s+String\s+@unique/);
    });

    it("exposes one-to-many relations to users and roles", () => {
      const b = block();
      expect(b).toMatch(/users\s+User\[\]/);
      expect(b).toMatch(/roles\s+Role\[\]/);
    });
  });

  describe("Role model", () => {
    const block = (): string => blockOf("Role");

    it("exists and maps to snake_case table `roles`", () => {
      expect(block()).toMatch(/@@map\(\s*"roles"\s*\)/);
    });

    it("scopes the (tenantId, name) combo as unique", () => {
      expect(block()).toMatch(/@@unique\(\s*\[\s*tenantId\s*,\s*name\s*\]\s*\)/);
    });

    it("snake_case-maps tenant_id and timestamps", () => {
      const b = block();
      expect(b).toMatch(/tenantId[\s\S]*@map\(\s*"tenant_id"\s*\)/);
      expect(b).toMatch(/createdAt[\s\S]*@map\(\s*"created_at"\s*\)/);
    });
  });

  describe("Repo-level conventions", () => {
    it("every datetime column carries an @map directive (no camelCase columns leak to the DB)", () => {
      const datetimeLines = SCHEMA.split("\n").filter((l) => /\s+DateTime\b/.test(l));
      for (const line of datetimeLines) {
        expect(line, `missing @map on: ${line.trim()}`).toMatch(/@map\(/);
      }
    });
  });
});
