/**
 * Tenant-id retrieval helper for the Example module.
 *
 * Pulls the active tenant id off the AsyncLocalStorage that
 * `TenantInterceptor` populates on every non-exempt request. If the
 * value is missing the route is hitting a non-tenant-aware code path
 * — usually because the path is in `EXEMPT_PREFIXES`, which means
 * either the controller shouldn't be there or the prefix list is
 * wrong. Either way it's a configuration bug, not a user-input
 * problem, so we throw a plain Error (the global filter maps it to
 * `CORE_INTERNAL` 500).
 *
 * Kept in its own file because the same helper is useful in any
 * tenant-scoped controller — copy + rename for your real module.
 */

import { getCurrentTenantId } from "../../core/multi-tenancy/tenant.interceptor.js";

export function requireTenant(): string {
  const tenantId = getCurrentTenantId();
  if (!tenantId) {
    throw new Error("example: no tenant id in request context (route is exempt?)");
  }
  return tenantId;
}
