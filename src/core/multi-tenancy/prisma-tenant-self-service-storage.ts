import type { PrismaClient } from "@prisma/client";

import type {
  TenantPlanRow,
  TenantSelfServiceStorage,
  TenantWithMembership,
} from "./tenant-self-service.service.js";
import type { TenantMemberRecord } from "./tenant-member.types.js";

/**
 * Prisma-backed `TenantSelfServiceStorage`.
 *
 * After issue #118 the canonical tenant layer is Better-Auth's
 * `organization`/`member` tables. This adapter:
 *   - replaces `tx.tenant.create(...)` with `tx.organization.create(...)`
 *   - replaces `tenantMember` references with `member` + organizationId
 *   - removes the `User.tenantId` update (the column was dropped in
 *     migration 20260508120000_drop_old_tenant_tables)
 *
 * The class has no business rules of its own; it adapts the storage
 * interface declared in `tenant-self-service.service.ts`. Validation
 * (empty name, owner id present) lives in the service layer so it
 * stays testable without a DB.
 */

interface PrismaSlice {
  organization: {
    findUnique(input: {
      where: { slug: string };
    }): Promise<{ id: string; name: string; createdAt: Date } | null>;
  };
  member: {
    findMany(input: {
      where: { userId: string };
      include: { organization: true };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<MemberWithOrganization[]>;
  };
  $transaction<T>(fn: (tx: PrismaTxSlice) => Promise<T>): Promise<T>;
}

interface PrismaTxSlice {
  organization: {
    create(input: { data: { id: string; name: string; slug: string; createdAt: Date } }): Promise<{
      id: string;
      name: string;
      createdAt: Date;
    }>;
  };
  member: {
    create(input: {
      data: {
        id: string;
        userId: string;
        organizationId: string;
        role: string;
        createdAt: Date;
      };
    }): Promise<{
      id: string;
      userId: string;
      organizationId: string;
      role: string;
      createdAt: Date;
    }>;
  };
}

interface MemberWithOrganization {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt: Date;
  organization: {
    id: string;
    name: string;
    createdAt: Date;
  };
}

export class PrismaTenantSelfServiceStorage implements TenantSelfServiceStorage {
  constructor(
    private readonly prisma: Pick<PrismaClient, "organization" | "member" | "$transaction">,
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
    // BA's Organization uses `slug` as the unique discriminator.
    // Derive the slug from the name using the same logic as createTenantWithMember.
    const slug = nameToSlug(name);
    const row = await this.slice().organization.findUnique({
      where: { slug },
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
      const insertedOrg = await tx.organization.create({
        data: {
          id: tenant.id,
          name: tenant.name,
          slug: nameToSlug(tenant.name),
          createdAt: tenant.createdAt,
        },
      });
      const joinedAt = member.joinedAt ?? new Date();
      const insertedMember = await tx.member.create({
        data: {
          id: member.id,
          userId: member.userId,
          organizationId: tenant.id,
          role: member.role,
          createdAt: joinedAt,
        },
      });
      return {
        tenant: {
          id: insertedOrg.id,
          name: insertedOrg.name,
          createdAt: insertedOrg.createdAt,
        },
        member: {
          id: insertedMember.id,
          userId: insertedMember.userId,
          // Surface organizationId as tenantId for the service layer.
          tenantId: insertedMember.organizationId,
          role: insertedMember.role,
          // BA member rows are always active — presence implies ACTIVE status.
          status: "ACTIVE",
          joinedAt: insertedMember.createdAt,
        },
      };
    });
  }

  async listMembershipsForUser(userId: string): Promise<TenantWithMembership[]> {
    const rows = await this.slice().member.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      tenantId: r.organization.id,
      tenantName: r.organization.name,
      tenantCreatedAt: r.organization.createdAt,
      memberId: r.id,
      role: r.role,
      // BA member table only stores active members.
      status: "ACTIVE" as const,
      joinedAt: r.createdAt,
    }));
  }
}

/**
 * Derive a URL-safe slug from a tenant name.
 * Used as the BA Organization's unique `slug` discriminator.
 */
function nameToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
