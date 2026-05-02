import type { PrismaClient } from "@prisma/client";

import type {
  TenantPlanRow,
  TenantSelfServiceStorage,
  TenantWithMembership,
} from "./tenant-self-service.service.js";
import type { TenantMemberRecord, TenantMemberStatus } from "./tenant-member.service.js";

/**
 * Prisma-backed `TenantSelfServiceStorage`.
 *
 * Persists tenant + first-member rows in a single `$transaction` so
 * `POST /tenants` never leaves a tenant without an owner. The lookup
 * path on `listMembershipsForUser()` joins through the relation Prisma
 * already declares (`User.memberships → tenant`).
 *
 * The class has no business rules of its own; it adapts the storage
 * interface declared in `tenant-self-service.service.ts`. Validation
 * (empty name, owner id present) lives in the service layer so it
 * stays testable without a DB.
 */

interface PrismaSlice {
  tenant: {
    findUnique(input: {
      where: { name: string };
    }): Promise<{ id: string; name: string; createdAt: Date } | null>;
  };
  tenantMember: {
    findMany(input: {
      where: { userId: string };
      include: { tenant: true };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<TenantMemberWithTenant[]>;
  };
  $transaction<T>(fn: (tx: PrismaTxSlice) => Promise<T>): Promise<T>;
}

interface PrismaTxSlice {
  tenant: {
    create(input: { data: { id: string; name: string; createdAt: Date } }): Promise<{
      id: string;
      name: string;
      createdAt: Date;
    }>;
  };
  tenantMember: {
    create(input: {
      data: {
        id: string;
        userId: string;
        tenantId: string;
        role: string;
        status: TenantMemberStatus;
        joinedAt: Date;
      };
    }): Promise<{
      id: string;
      userId: string;
      tenantId: string;
      role: string;
      status: TenantMemberStatus;
      joinedAt: Date | null;
    }>;
  };
}

interface TenantMemberWithTenant {
  id: string;
  userId: string;
  tenantId: string;
  role: string;
  status: TenantMemberStatus;
  invitedAt: Date | null;
  joinedAt: Date | null;
  tenant: {
    id: string;
    name: string;
    createdAt: Date;
  };
}

export class PrismaTenantSelfServiceStorage implements TenantSelfServiceStorage {
  constructor(
    private readonly prisma: Pick<PrismaClient, "tenant" | "tenantMember" | "$transaction">,
  ) {}

  async findTenantByName(name: string): Promise<TenantPlanRow | null> {
    const row = await (this.prisma as unknown as PrismaSlice).tenant.findUnique({
      where: { name },
    });
    return row ? { id: row.id, name: row.name, createdAt: row.createdAt } : null;
  }

  async createTenantWithMember({
    tenant,
    member,
  }: {
    tenant: TenantPlanRow;
    member: TenantMemberRecord;
  }): Promise<{ tenant: TenantPlanRow; member: TenantMemberRecord }> {
    return (this.prisma as unknown as PrismaSlice).$transaction(async (tx) => {
      const insertedTenant = await tx.tenant.create({
        data: { id: tenant.id, name: tenant.name, createdAt: tenant.createdAt },
      });
      const joinedAt = member.joinedAt ?? new Date();
      const insertedMember = await tx.tenantMember.create({
        data: {
          id: member.id,
          userId: member.userId,
          tenantId: tenant.id,
          role: member.role,
          status: member.status,
          joinedAt,
        },
      });
      return {
        tenant: {
          id: insertedTenant.id,
          name: insertedTenant.name,
          createdAt: insertedTenant.createdAt,
        },
        member: {
          id: insertedMember.id,
          userId: insertedMember.userId,
          tenantId: insertedMember.tenantId,
          role: insertedMember.role,
          status: insertedMember.status,
          ...(insertedMember.joinedAt ? { joinedAt: insertedMember.joinedAt } : {}),
        },
      };
    });
  }

  async listMembershipsForUser(userId: string): Promise<TenantWithMembership[]> {
    const rows = await (this.prisma as unknown as PrismaSlice).tenantMember.findMany({
      where: { userId },
      include: { tenant: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      tenantId: r.tenant.id,
      tenantName: r.tenant.name,
      tenantCreatedAt: r.tenant.createdAt,
      memberId: r.id,
      role: r.role,
      status: r.status,
      ...(r.invitedAt ? { invitedAt: r.invitedAt } : {}),
      ...(r.joinedAt ? { joinedAt: r.joinedAt } : {}),
    }));
  }
}
