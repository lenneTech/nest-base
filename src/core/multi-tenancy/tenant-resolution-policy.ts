/**
 * Tenant scope is resolved exclusively from the Better-Auth session
 * (`activeOrganizationId` after `POST /api/auth/organization/set-active`).
 *
 * The `x-tenant-id` header is no longer read on any path. Operator UIs
 * (Hub / Admin) switch tenants by calling `set-active`, same as app clients.
 */
export const TENANT_RESOLUTION_SOURCE = "session.activeOrganizationId" as const;
