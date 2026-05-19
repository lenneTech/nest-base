/**
 * Resolves the tenant id used to build CASL for `/hub/*` JSON/HTML.
 *
 * Hub routes are exempt from the `x-tenant-id` header (see
 * `tenant-guard.ts`) but still use `@Can("read", "DevHub")`. The ability
 * middleware must not install an empty ability on those paths.
 */
import type { PrismaService } from "../prisma/prisma.service.js";

export interface HubOperatorUser {
  id: string;
  activeOrganizationId?: string | null;
}

export async function resolveHubOperatorTenantId(
  user: HubOperatorUser,
  prisma: Pick<PrismaService, "member">,
): Promise<string | null> {
  if (user.activeOrganizationId) {
    return user.activeOrganizationId;
  }
  const member = await prisma.member.findFirst({
    where: { userId: user.id },
    select: { organizationId: true },
    orderBy: { createdAt: "asc" },
  });
  return member?.organizationId ?? null;
}
