import { describe, expect, it } from "vitest";

import {
  TenantNameTakenError,
  TenantSelfServiceService,
  type TenantSelfServiceStorage,
  type TenantWithMembership,
} from "../../src/core/multi-tenancy/tenant-self-service.service.js";
import {
  type TenantMemberRecord,
  TenantMemberService,
} from "../../src/core/multi-tenancy/tenant-member.service.js";

/**
 * Story · Tenant self-service
 *
 * Closes a friction-log finding: a freshly signed-up user has no way
 * to (a) list tenants they belong to, or (b) bootstrap their first
 * tenant. The service exposes two operations:
 *
 *   - `createForUser({ name, ownerId })` — creates a Tenant + an
 *     ACTIVE TenantMember with the "owner" role for the caller, atomically.
 *   - `listForUser(userId)` — returns the joined Tenant + membership
 *     rows for the caller.
 *
 * The service is storage-agnostic so the controller layer can pass an
 * in-memory fake here. The Prisma adapter lives in a sibling test
 * (`tests/multi-tenancy.e2e-spec.ts` is the integration surface).
 */
describe("Story · Tenant self-service", () => {
  interface TenantRow {
    id: string;
    name: string;
    createdAt: Date;
  }

  function makeFake(): TenantSelfServiceStorage & {
    tenants: TenantRow[];
    members: TenantMemberRecord[];
  } {
    const tenants: TenantRow[] = [];
    const members: TenantMemberRecord[] = [];
    return {
      get tenants() {
        return tenants;
      },
      get members() {
        return members;
      },
      async findTenantByName(name) {
        return tenants.find((t) => t.name === name) ?? null;
      },
      async createTenantWithMember({ tenant, member }) {
        tenants.push(tenant);
        members.push(member);
        return { tenant, member };
      },
      async listMembershipsForUser(userId) {
        const out: TenantWithMembership[] = [];
        for (const m of members) {
          if (m.userId !== userId) continue;
          const t = tenants.find((row) => row.id === m.tenantId);
          if (!t) continue;
          out.push({
            tenantId: t.id,
            tenantName: t.name,
            tenantCreatedAt: t.createdAt,
            memberId: m.id,
            role: m.role,
            status: m.status,
            ...(m.invitedAt ? { invitedAt: m.invitedAt } : {}),
            ...(m.joinedAt ? { joinedAt: m.joinedAt } : {}),
          });
        }
        return out;
      },
    };
  }

  describe("createForUser()", () => {
    it("creates a Tenant + an ACTIVE owner membership for the caller", async () => {
      const storage = makeFake();
      const svc = new TenantSelfServiceService(storage, new TenantMemberService(stubMemberStore()));
      const result = await svc.createForUser({ name: "Acme Inc.", ownerId: "u1" });

      expect(result.tenant.name).toBe("Acme Inc.");
      expect(storage.tenants).toHaveLength(1);
      expect(storage.members).toHaveLength(1);

      const m = storage.members[0]!;
      expect(m.userId).toBe("u1");
      expect(m.tenantId).toBe(result.tenant.id);
      expect(m.role).toBe("owner");
      expect(m.status).toBe("ACTIVE");
      expect(m.joinedAt).toBeInstanceOf(Date);
    });

    it("rejects an empty / blank tenant name with BadRequest semantics", async () => {
      const svc = new TenantSelfServiceService(
        makeFake(),
        new TenantMemberService(stubMemberStore()),
      );
      await expect(svc.createForUser({ name: "", ownerId: "u1" })).rejects.toThrow(
        /name is required/,
      );
      await expect(svc.createForUser({ name: "   ", ownerId: "u1" })).rejects.toThrow(
        /name is required/,
      );
    });

    it("trims surrounding whitespace from the tenant name before persisting", async () => {
      const storage = makeFake();
      const svc = new TenantSelfServiceService(storage, new TenantMemberService(stubMemberStore()));
      const result = await svc.createForUser({ name: "  Acme  ", ownerId: "u1" });
      expect(result.tenant.name).toBe("Acme");
      expect(storage.tenants[0]!.name).toBe("Acme");
    });

    it("rejects a duplicate tenant name with TenantNameTakenError", async () => {
      const storage = makeFake();
      const svc = new TenantSelfServiceService(storage, new TenantMemberService(stubMemberStore()));
      await svc.createForUser({ name: "Acme", ownerId: "u1" });
      await expect(svc.createForUser({ name: "Acme", ownerId: "u2" })).rejects.toThrow(
        TenantNameTakenError,
      );
    });
  });

  describe("listForUser()", () => {
    it("returns the joined tenant + membership rows for the caller, sorted by tenantName", async () => {
      const storage = makeFake();
      const svc = new TenantSelfServiceService(storage, new TenantMemberService(stubMemberStore()));
      await svc.createForUser({ name: "Zebra", ownerId: "u1" });
      await svc.createForUser({ name: "Acme", ownerId: "u1" });
      await svc.createForUser({ name: "Other", ownerId: "u2" });

      const list = await svc.listForUser("u1");
      expect(list.map((r) => r.tenantName)).toEqual(["Acme", "Zebra"]);
      expect(list.every((r) => r.role === "owner" && r.status === "ACTIVE")).toBe(true);
      expect(list[0]?.joinedAt).toBeInstanceOf(Date);
    });

    it("returns an empty array for a user with no memberships", async () => {
      const svc = new TenantSelfServiceService(
        makeFake(),
        new TenantMemberService(stubMemberStore()),
      );
      expect(await svc.listForUser("ghost")).toEqual([]);
    });
  });
});

/**
 * Stub for the inner `TenantMemberService` constructor argument. The
 * self-service service composes `TenantMemberService.add()` only
 * indirectly (through the storage adapter for atomicity), so the
 * member-store passed here just needs to satisfy the typeshape — the
 * tests above call into `TenantSelfServiceStorage` directly.
 */
function stubMemberStore() {
  return {
    findByUserAndTenant: async () => null,
    listByTenant: async () => [],
    insert: async (record: TenantMemberRecord) => record,
    updateStatus: async () => null,
    remove: async () => false,
  };
}
