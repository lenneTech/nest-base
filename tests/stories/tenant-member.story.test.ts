import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  TenantMemberAlreadyExistsError,
  TenantMemberNotFoundError,
  TenantMemberService,
  type TenantMemberRecord,
  type TenantMemberStorage,
} from "../../src/core/multi-tenancy/tenant-member.service.js";

const ROOT = resolve(import.meta.dirname, "..", "..");

/**
 * Story · Tenant-Member-CRUD
 *
 * The membership join-table glues users to tenants with a role and a
 * lifecycle status (ACTIVE / INVITED / SUSPENDED). This service is
 * storage-agnostic — the Prisma adapter wires up in a follow-up slice.
 */
describe("Story · Tenant-Member CRUD", () => {
  function makeStorage(
    initial: TenantMemberRecord[] = [],
  ): TenantMemberStorage & { records: TenantMemberRecord[] } {
    const records: TenantMemberRecord[] = [...initial];
    return {
      get records() {
        return records;
      },
      async findByUserAndTenant(userId, tenantId) {
        return records.find((r) => r.userId === userId && r.tenantId === tenantId) ?? null;
      },
      async listByTenant(tenantId) {
        return records.filter((r) => r.tenantId === tenantId);
      },
      async insert(record) {
        records.push(record);
        return record;
      },
      async updateStatus(id, status) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return null;
        records[idx] = { ...records[idx]!, status };
        return records[idx]!;
      },
      async remove(id) {
        const idx = records.findIndex((r) => r.id === id);
        if (idx < 0) return false;
        records.splice(idx, 1);
        return true;
      },
    };
  }

  describe("add()", () => {
    it("creates an INVITED membership by default with invitedAt set", async () => {
      const storage = makeStorage();
      const svc = new TenantMemberService(storage);
      const member = await svc.add({ userId: "u1", tenantId: "t1", role: "editor" });
      expect(member.status).toBe("INVITED");
      expect(member.invitedAt).toBeInstanceOf(Date);
      expect(member.joinedAt).toBeUndefined();
      expect(storage.records).toHaveLength(1);
    });

    it("rejects a duplicate (userId, tenantId) pair", async () => {
      const storage = makeStorage();
      const svc = new TenantMemberService(storage);
      await svc.add({ userId: "u1", tenantId: "t1", role: "editor" });
      await expect(svc.add({ userId: "u1", tenantId: "t1", role: "admin" })).rejects.toThrow(
        TenantMemberAlreadyExistsError,
      );
    });
  });

  describe("listByTenant()", () => {
    it("returns members of the given tenant only", async () => {
      const storage = makeStorage();
      const svc = new TenantMemberService(storage);
      await svc.add({ userId: "u1", tenantId: "t1", role: "editor" });
      await svc.add({ userId: "u2", tenantId: "t1", role: "viewer" });
      await svc.add({ userId: "u3", tenantId: "t2", role: "admin" });

      const t1 = await svc.listByTenant("t1");
      expect(t1.map((m) => m.userId).sort()).toEqual(["u1", "u2"]);
    });
  });

  describe("activate() / suspend()", () => {
    it("activate() flips INVITED → ACTIVE and sets joinedAt", async () => {
      const storage = makeStorage();
      const svc = new TenantMemberService(storage);
      const m = await svc.add({ userId: "u1", tenantId: "t1", role: "editor" });
      const activated = await svc.activate(m.id);
      expect(activated.status).toBe("ACTIVE");
      expect(activated.joinedAt).toBeInstanceOf(Date);
    });

    it("suspend() flips status to SUSPENDED", async () => {
      const storage = makeStorage();
      const svc = new TenantMemberService(storage);
      const m = await svc.add({ userId: "u1", tenantId: "t1", role: "editor" });
      const suspended = await svc.suspend(m.id);
      expect(suspended.status).toBe("SUSPENDED");
    });

    it("throws TenantMemberNotFoundError for an unknown id", async () => {
      const svc = new TenantMemberService(makeStorage());
      await expect(svc.activate("missing")).rejects.toThrow(TenantMemberNotFoundError);
      await expect(svc.suspend("missing")).rejects.toThrow(TenantMemberNotFoundError);
    });
  });

  describe("remove()", () => {
    it("removes the membership by id", async () => {
      const storage = makeStorage();
      const svc = new TenantMemberService(storage);
      const m = await svc.add({ userId: "u1", tenantId: "t1", role: "editor" });
      await svc.remove(m.id);
      expect(storage.records).toHaveLength(0);
    });

    it("throws TenantMemberNotFoundError when the id is unknown", async () => {
      const svc = new TenantMemberService(makeStorage());
      await expect(svc.remove("missing")).rejects.toThrow(TenantMemberNotFoundError);
    });
  });

  describe("Prisma schema", () => {
    const SCHEMA = readFileSync(resolve(ROOT, "prisma/schema.prisma"), "utf8");

    it("declares a TenantMember model mapped to `tenant_members`", () => {
      expect(SCHEMA).toMatch(/model\s+TenantMember\s*\{/);
      expect(SCHEMA).toMatch(/@@map\(\s*"tenant_members"\s*\)/);
    });

    it("declares the TenantMemberStatus enum", () => {
      expect(SCHEMA).toMatch(
        /enum\s+TenantMemberStatus\s*\{[\s\S]*ACTIVE[\s\S]*INVITED[\s\S]*SUSPENDED[\s\S]*\}/,
      );
    });

    it("enforces a unique (user_id, tenant_id) pair on the membership", () => {
      const block = SCHEMA.match(/model\s+TenantMember\s*\{[\s\S]*?\n\}/m)?.[0] ?? "";
      expect(block).toMatch(/@@unique\(\s*\[\s*userId\s*,\s*tenantId\s*\]\s*\)/);
    });
  });
});
