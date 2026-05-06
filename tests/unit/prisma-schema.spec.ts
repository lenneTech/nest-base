import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..", "..");
const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");

/**
 * Prisma schema v1.
 *
 * Slice deliverable: User / Organization / Role models with `@@map` (table)
 * and `@map` (column) snake_case mappings.
 *
 * After issue #118 the legacy `Tenant`/`TenantMember` models are gone —
 * Better-Auth's `Organization`/`Member` tables are the canonical tenant layer.
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

    it("has orgMemberships relation to BA Member table (issue #118)", () => {
      // After issue #118 User.tenantId is removed; membership is via BA Member.
      const b = block();
      expect(b).toMatch(/orgMemberships\s+Member\[\]/);
    });
  });

  describe("Organization model (BA canonical tenant — issue #118)", () => {
    const block = (): string => blockOf("Organization");

    it("exists and maps to snake_case table `organization`", () => {
      expect(block()).toMatch(/@@map\(\s*"organization"\s*\)/);
    });

    it("has id and name", () => {
      const b = block();
      expect(b).toMatch(/^\s*id\s+String\s+@id/m);
      expect(b).toMatch(/name\s+String/);
    });

    it("exposes members[] and invitations[] relations", () => {
      const b = block();
      expect(b).toMatch(/members\s+Member\[\]/);
      expect(b).toMatch(/invitations\s+Invitation\[\]/);
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
