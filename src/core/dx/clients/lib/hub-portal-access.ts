/**
 * Client-side mirror of `GET /hub/portal-access.json` (includes legacy `devHub`).
 */
export interface HubPortalNavFeatures {
  multiTenancy: boolean;
  files: boolean;
  email: boolean;
  webhooks: boolean;
  search: boolean;
  realtime: boolean;
  audit: boolean;
  rateLimit: boolean;
  jobs: boolean;
}

export interface HubPortalAccessPayload {
  hub?: boolean;
  tenantAdmin?: boolean;
  features?: HubPortalNavFeatures;
  /** @deprecated Pre-rename API field — remove after all clients refresh. */
  devHub?: boolean;
}

export function hasHubPortalAccess(data: HubPortalAccessPayload | undefined): boolean {
  if (!data) return false;
  return data.hub === true || data.devHub === true;
}

export function hasTenantAdminPortalAccess(data: HubPortalAccessPayload | undefined): boolean {
  return data?.tenantAdmin === true;
}

/** Post-login / session-restore navigation target from portal-access flags. */
export function resolveOperatorLandingPath(
  data: HubPortalAccessPayload,
  fromState?: string,
): string {
  const hubOk = hasHubPortalAccess(data);
  const tenantAdminOk = hasTenantAdminPortalAccess(data);
  const fromRaw = fromState?.trim();
  const from =
    fromRaw && fromRaw !== "/" ? fromRaw : hubOk ? "/hub" : tenantAdminOk ? "/admin/users" : "/";
  if (from.startsWith("/hub") && !hubOk) {
    return tenantAdminOk ? "/admin/users" : "/";
  }
  if (from.startsWith("/admin") && !tenantAdminOk) {
    return hubOk ? "/hub" : "/";
  }
  return from;
}
