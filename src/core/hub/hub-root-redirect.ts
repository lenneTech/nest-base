/**
 * Shared Hub root (`GET /`) redirect decision for the Express handler in
 * bootstrap.ts — mirrors session + CASL checks used by the middleware stack.
 */
import type { INestApplication } from "@nestjs/common";
import type { Request } from "express";

import { canAccessHub, canAccessTenantAdmin } from "./hub-portal-access.js";

export type HubRootRedirectTarget = "/hub" | "/admin/users";

/**
 * When the caller has a Better-Auth session, return `/hub` (system
 * admin) or `/admin/users` (tenant admin). Otherwise `null` (login shell).
 */
export async function resolveHubRootRedirectTarget(
  app: INestApplication,
  req: Request,
): Promise<HubRootRedirectTarget | null> {
  const betterAuthToken = await import("../auth/better-auth.token.js");
  const betterAuthInstance = app.get(betterAuthToken.BETTER_AUTH_INSTANCE, {
    strict: false,
  }) as {
    api: { getSession(opts: { headers: unknown }): Promise<unknown> };
  } | null;

  if (!betterAuthInstance) {
    return null;
  }

  const { fromNodeHeaders } = await import("better-auth/node");
  let lookup: {
    user?: { id: string; tenantId?: string | null };
    session?: { activeOrganizationId?: string | null };
  } | null;

  try {
    lookup = (await betterAuthInstance.api.getSession({
      headers: fromNodeHeaders(req.headers),
    })) as typeof lookup;
  } catch {
    return null;
  }

  const userId = lookup?.user?.id;
  if (!userId || !lookup?.user) {
    return null;
  }

  const sessionUser = lookup.user;
  (
    req as {
      user?: { id: string; tenantId?: string | null; activeOrganizationId?: string | null };
    }
  ).user = {
    id: userId,
    tenantId: sessionUser.tenantId ?? null,
    activeOrganizationId: lookup.session?.activeOrganizationId ?? null,
  };

  const { PermissionService } = await import("../permissions/permission.service.js");
  const { resolveRequestTenantId } = await import("../multi-tenancy/resolve-request-tenant.js");
  const { PrismaService } = await import("../prisma/prisma.service.js");

  const permissionService = app.get(PermissionService, { strict: false });
  const prismaService = app.get(PrismaService, { strict: false });
  if (!permissionService || !prismaService) {
    return null;
  }

  try {
    const tenantId = await resolveRequestTenantId(req, prismaService);
    if (!tenantId) {
      return null;
    }
    const ability = await permissionService.abilityFor(userId, tenantId);
    if (canAccessHub(ability)) {
      return "/hub";
    }
    if (canAccessTenantAdmin(ability)) {
      return "/admin/users";
    }
  } catch {
    return null;
  }

  return null;
}
