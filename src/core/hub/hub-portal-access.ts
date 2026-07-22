/**
 * CASL helpers for Hub vs Admin operator surfaces (pure functions).
 */
import type { Ability } from "../permissions/casl-ability.js";
import { canManageSubject, grantsHubPortalAccess } from "../permissions/ability-subject-access.js";

/** Cockpit + diagnostics + feature toggles (`/hub/*`). */
export function canAccessHub(ability: Ability | undefined): boolean {
  if (!ability) return false;
  return grantsHubPortalAccess(ability);
}

/** Tenant admin CRUD + inspectors (`/admin/*` JSON + pages). */
export function canAccessTenantAdmin(ability: Ability | undefined): boolean {
  if (!ability) return false;
  if (canManageSubject(ability, "all")) return true;
  return (
    canManageSubject(ability, "User") ||
    canManageSubject(ability, "TenantAdmin") ||
    canManageSubject(ability, "Role") ||
    canManageSubject(ability, "Policy") ||
    canManageSubject(ability, "Permission")
  );
}

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

export interface HubPortalAccessSnapshot {
  hub: boolean;
  tenantAdmin: boolean;
  features: HubPortalNavFeatures;
  /**
   * Workstation-tier surfaces servable? `true` exactly in development
   * (`isHubSurfaceAvailable({tier: "workstation"})`). The SPA's only
   * environment signal — deliberately a boolean, not the raw NODE_ENV,
   * so the probe leaks nothing beyond what the 404s already prove.
   */
  workstation: boolean;
}

export function buildHubPortalAccessSnapshot(
  ability: Ability | undefined,
  features: HubPortalNavFeatures,
  workstation: boolean,
): HubPortalAccessSnapshot {
  return {
    hub: canAccessHub(ability),
    tenantAdmin: canAccessTenantAdmin(ability),
    features,
    workstation,
  };
}
