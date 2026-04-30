import type { PrismaClient } from "@prisma/client";

import type {
  TenantMemberRecord,
  TenantMemberStatus,
  TenantMemberStorage,
} from "./tenant-member.service.js";

/**
 * Prisma-backed TenantMemberStorage.
 *
 * Persists memberships to the `tenant_members` table declared in
 * `prisma/schema.prisma`. The earlier `InMemoryTenantMemberStorage`
 * is kept around for tests / fake-prisma scenarios; this class is the
 * production default wired up in `tenant-member.module.ts`.
 *
 * Why a separate class instead of inlining into `TenantMemberService`:
 * the service stays storage-agnostic (matches the rest of the core's
 * pure-planner / thin-runner split — every storage adapter passes the
 * same `TenantMemberStorage` interface).
 */
export class PrismaTenantMemberStorage implements TenantMemberStorage {
  constructor(private readonly prisma: Pick<PrismaClient, "tenantMember">) {}

  async findByUserAndTenant(userId: string, tenantId: string): Promise<TenantMemberRecord | null> {
    const row = await this.prisma.tenantMember.findFirst({
      where: { userId, tenantId },
    });
    return row ? toRecord(row) : null;
  }

  async listByTenant(tenantId: string): Promise<TenantMemberRecord[]> {
    const rows = await this.prisma.tenantMember.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toRecord);
  }

  async insert(record: TenantMemberRecord): Promise<TenantMemberRecord> {
    const row = await this.prisma.tenantMember.create({
      data: {
        id: record.id,
        userId: record.userId,
        tenantId: record.tenantId,
        role: record.role,
        status: record.status,
        invitedAt: record.invitedAt ?? null,
        joinedAt: record.joinedAt ?? null,
      },
    });
    return toRecord(row);
  }

  async updateStatus(id: string, status: TenantMemberStatus): Promise<TenantMemberRecord | null> {
    try {
      const row = await this.prisma.tenantMember.update({
        where: { id },
        data: {
          status,
          // Stamp `joined_at` on the INVITED → ACTIVE transition. The
          // service's `activate()` does the same, but we set it here too
          // so a direct adapter call doesn't need a follow-up write.
          ...(status === "ACTIVE" ? { joinedAt: new Date() } : {}),
        },
      });
      return toRecord(row);
    } catch (err) {
      // Prisma 7 throws P2025 for "record not found"; the contract
      // says "return null" so the service can map it to its own
      // not-found error.
      if (isPrismaNotFound(err)) return null;
      throw err;
    }
  }

  async remove(id: string): Promise<boolean> {
    try {
      await this.prisma.tenantMember.delete({ where: { id } });
      return true;
    } catch (err) {
      if (isPrismaNotFound(err)) return false;
      throw err;
    }
  }
}

interface TenantMemberRow {
  id: string;
  userId: string;
  tenantId: string;
  role: string;
  status: TenantMemberStatus;
  invitedAt: Date | null;
  joinedAt: Date | null;
}

function toRecord(row: TenantMemberRow): TenantMemberRecord {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    role: row.role,
    status: row.status,
    ...(row.invitedAt ? { invitedAt: row.invitedAt } : {}),
    ...(row.joinedAt ? { joinedAt: row.joinedAt } : {}),
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
