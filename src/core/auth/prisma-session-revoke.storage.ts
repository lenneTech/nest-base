/**
 * Prisma-backed `SessionRevokeStorage` for the template dev hub.
 *
 * Users admin reads sessions directly from Prisma; this adapter keeps
 * `/hub/admin/sessions/list.json` on the same data source instead of the
 * no-op sentinel that always returned `[]`.
 */
import type { Prisma } from "@prisma/client";

import type { PrismaService } from "../prisma/prisma.service.js";
import type { SessionRevokeStorage } from "./sessions-admin.controller.js";
import type { SessionRecord } from "./sessions-admin.planner.js";

/** Optional tenant gate for session inventory (active org on the session row). */
export function buildSessionListWhere(
  tenantId?: string | null,
): Prisma.SessionWhereInput | undefined {
  const scoped = tenantId?.trim();
  if (!scoped) return undefined;
  return { activeOrganizationId: scoped };
}

export function mapPrismaSessionRow(row: {
  id: string;
  userId: string;
  createdAt: Date;
  activeOrganizationId: string | null;
}): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt.getTime(),
    tenantId: row.activeOrganizationId ?? "UNKNOWN",
  };
}

export class PrismaSessionRevokeStorage implements SessionRevokeStorage {
  constructor(private readonly prisma: PrismaService) {}

  async listAllSessions(tenantId?: string): Promise<readonly SessionRecord[]> {
    const rows = await this.prisma.session.findMany({
      where: buildSessionListWhere(tenantId),
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        userId: true,
        createdAt: true,
        activeOrganizationId: true,
      },
    });
    return rows.map(mapPrismaSessionRow);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.session.delete({ where: { id: sessionId } });
  }
}
