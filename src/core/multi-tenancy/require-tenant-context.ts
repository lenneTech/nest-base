import { BadRequestException } from "@nestjs/common";

import { getCurrentTenantId } from "./tenant-context.js";

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Reads the active tenant from TenantInterceptor ALS (session
 * `activeOrganizationId` after Better-Auth `set-active`).
 */
export function requireTenantContext(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new BadRequestException("tenant context is required");
  }
  if (!UUID_PATTERN.test(tenantId)) {
    throw new BadRequestException("tenant context must be a valid UUID");
  }
  return tenantId;
}
