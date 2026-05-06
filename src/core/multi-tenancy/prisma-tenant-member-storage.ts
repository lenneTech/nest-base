import type { PrismaClient } from "@prisma/client";

import type {
  TenantMemberRecord,
  TenantMemberStatus,
  TenantMemberStorage,
} from "./tenant-member.types.js";

/**
 * Prisma-backed TenantMemberStorage backed by Better-Auth's `member` table.
 *
 * After issue #118 migrated the canonical tenant layer from the hand-rolled
 * `tenant_members` table to Better-Auth's `organization`/`member` tables,
 * this adapter now reads/writes `prisma.member` instead of the old
 * `prisma.tenantMember`. The interface contract (`TenantMemberStorage`) is
 * unchanged so all callers remain unaffected.
 *
 * Model mapping:
 *   - `prisma.tenantMember` → `prisma.member`
 *   - `tenantId`            → `organizationId`
 *   - BA's `member` table only stores active members; a found row = ACTIVE.
 *     Invitations live in the `invitation` table (not managed here).
 */
export class PrismaTenantMemberStorage implements TenantMemberStorage {
  constructor(private readonly prisma: Pick<PrismaClient, "member">) {}

  async findByUserAndTenant(userId: string, tenantId: string): Promise<TenantMemberRecord | null> {
    const row = await this.prisma.member.findFirst({
      where: { userId, organizationId: tenantId },
    });
    return row ? toRecord(row) : null;
  }

  async listByTenant(tenantId: string): Promise<TenantMemberRecord[]> {
    const rows = await this.prisma.member.findMany({
      where: { organizationId: tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRecord);
  }

  async insert(record: TenantMemberRecord): Promise<TenantMemberRecord> {
    const row = await this.prisma.member.create({
      data: {
        id: record.id,
        userId: record.userId,
        organizationId: record.tenantId,
        role: record.role,
        createdAt: record.joinedAt ?? new Date(),
      },
    });
    return toRecord(row);
  }

  // BA's `member` table has no explicit status column — presence = ACTIVE.
  // `updateStatus` is a no-op for ACTIVE (nothing to write), and removes
  // the row for SUSPENDED (the closest equivalent to revoking membership).
  async updateStatus(id: string, status: TenantMemberStatus): Promise<TenantMemberRecord | null> {
    try {
      if (status === "SUSPENDED") {
        // BA has no suspended state — remove the membership row instead.
        await this.prisma.member.delete({ where: { id } });
        return null;
      }
      // For ACTIVE: the row already exists, return it as-is.
      const row = await this.prisma.member.findFirst({ where: { id } });
      return row ? toRecord(row) : null;
    } catch (err) {
      if (isPrismaNotFound(err)) return null;
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.prisma.member.delete({ where: { id } });
      return true;
    } catch (err) {
      if (isPrismaNotFound(err)) return false;
      throw err;
    }
  }
}

interface MemberRow {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
  createdAt: Date;
}

function toRecord(row: MemberRow): TenantMemberRecord {
  return {
    id: row.id,
    userId: row.userId,
    // Surface organizationId as tenantId so callers see the same interface.
    tenantId: row.organizationId,
    role: row.role,
    // BA member rows are always active — presence implies ACTIVE status.
    status: "ACTIVE",
    joinedAt: row.createdAt,
  };
}

function isPrismaNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2025"
  );
}
