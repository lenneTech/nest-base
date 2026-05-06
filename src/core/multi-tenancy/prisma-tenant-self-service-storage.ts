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
  user: {
    updateMany(input: {
      where: { id: string; tenantId: null };
      data: { tenantId: string };
    }): Promise<{ count: number }>;
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
    private readonly prisma: Pick<
      PrismaClient,
      "tenant" | "tenantMember" | "user" | "$transaction"
    >,
  ) {}

  /**
   * Type-erasing bridge: the constructor accepts a structurally-
   * narrowed slice of `PrismaClient`, but each method needs the
   * project's hand-rolled `PrismaSlice` interface (which uses
   * project-specific input types narrower than Prisma's generics).
   * Centralise the cast here so each call site reads cleanly. The
   * runtime contract is identical (Prisma generated the same
   * findUnique/create/findMany shape we declare); the static gap is
   * Prisma's generic-constraint strictness.
   */
  private slice(): PrismaSlice {
    const erased: unknown = this.prisma;
    return erased as PrismaSlice;
  }

  async findTenantByName(name: string): Promise<TenantPlanRow | null> {
    const row = await this.slice().tenant.findUnique({
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
    return this.slice().$transaction(async (tx) => {
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
      // Promote the just-created tenant to the user's primary
      // tenant — but only if they don't already have one. The
      // `tenantId: null` guard makes this a no-op for users who are
      // creating their second/third tenant: we never silently
      // re-primary them, otherwise their existing tenant context
      // would flip on every POST /tenants. Closes friction-log
      // blocker (LLM-test 2026-05-03 #4): without this update the
      // session's `user.tenantId` stays null and `AbilityMiddleware`
      // resolves to an empty ability, 403'ing every `@Can()` route
      // for the freshly-onboarded user.
      await tx.user.updateMany({
        where: { id: member.userId, tenantId: null },
        data: { tenantId: tenant.id },
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
    const rows = await this.slice().tenantMember.findMany({
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
