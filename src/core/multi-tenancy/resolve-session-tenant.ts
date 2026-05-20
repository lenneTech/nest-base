import { BadRequestException } from "@nestjs/common";

/** Minimal request shape for reading `session.activeOrganizationId`. */
export interface SessionTenantSource {
  user?: { activeOrganizationId?: string | null } | null;
}

/**
 * Active organization id from the Better-Auth session
 * (`POST /api/auth/organization/set-active`). Use on exempt paths where
 * `TenantInterceptor` does not populate ALS (e.g. `/api/me/*`).
 */
export function resolveSessionTenantId(req: SessionTenantSource): string | null {
  return req.user?.activeOrganizationId ?? null;
}

/** Same as {@link resolveSessionTenantId} but throws when unset. */
export function requireSessionTenantId(req: SessionTenantSource): string {
  const tenantId = resolveSessionTenantId(req);
  if (!tenantId) {
    throw new BadRequestException(
      "active organization is required — call POST /api/auth/organization/set-active",
    );
  }
  return tenantId;
}
