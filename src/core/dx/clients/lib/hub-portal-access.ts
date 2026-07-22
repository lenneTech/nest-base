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
  /** Workstation-tier surfaces servable (true exactly in development). */
  workstation?: boolean;
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

/**
 * Workstation-tier surfaces servable? Only an explicit `false` hides
 * them — an absent field (server predating the flag) keeps today's
 * full nav, mirroring `LEGACY_HUB_NAV_FEATURES_FALLBACK` semantics.
 */
export function hasWorkstationSurfaces(data: HubPortalAccessPayload | undefined): boolean {
  return data?.workstation !== false;
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
    fromRaw && fromRaw !== "/"
      ? fromRaw
      : hubOk
        ? "/hub"
        : tenantAdminOk
          ? "/hub/admin/users"
          : "/";
  // `/hub/admin/*` (tenant-admin console) checks FIRST — it lives inside
  // the `/hub` prefix but is gated by tenantAdmin, not the Hub subject.
  if (from.startsWith("/hub/admin") && !tenantAdminOk) {
    return hubOk ? "/hub" : "/";
  }
  if (from.startsWith("/hub") && !from.startsWith("/hub/admin") && !hubOk) {
    return tenantAdminOk ? "/hub/admin/users" : "/";
  }
  return from;
}
