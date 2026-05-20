import type { Request } from "express";

import type { PrismaService } from "../prisma/prisma.service.js";

/**
 * Single source of truth for "what tenant id does this request operate
 * in?" — used by BOTH `TenantInterceptor` (RLS / `runWithTenant`) and
 * `AbilityMiddleware` (CASL ability) so the auth-tenant and the
 * data-tenant cannot disagree.
 *
 * Resolution: `session.activeOrganizationId` from Better-Auth
 * `POST /api/auth/organization/set-active`. Stray `x-tenant-id` headers
 * are ignored on every path.
 */
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    activeOrganizationId?: string | null;
  };
}

export interface ResolveRequestTenantOptions {
  /** Request path — reserved for logging/policy extensions. */
  path?: string;
}

export async function resolveRequestTenantId(
  req: AuthenticatedRequest,
  _prisma: Pick<PrismaService, "member">,
  _options: ResolveRequestTenantOptions = {},
): Promise<string | null> {
  return req.user?.activeOrganizationId ?? null;
}
