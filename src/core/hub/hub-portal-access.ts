/**
 * CASL helpers for Hub vs Admin operator surfaces (pure functions).
 */
import type { Ability } from "../permissions/casl-ability.js";

/** Cockpit + diagnostics + feature toggles (`/hub/*`). */
export function canAccessDevHub(ability: Ability | undefined): boolean {
  if (!ability) return false;
  return ability.can("manage", "all") || ability.can("read", "DevHub");
}

/** Tenant admin CRUD + inspectors (`/admin/*` JSON + pages). */
export function canAccessTenantAdmin(ability: Ability | undefined): boolean {
  if (!ability) return false;
  if (ability.can("manage", "all")) return true;
  return (
    ability.can("manage", "User") ||
    ability.can("manage", "TenantAdmin") ||
    ability.can("manage", "Role") ||
    ability.can("manage", "Policy") ||
    ability.can("manage", "Permission")
  );
}

export interface HubPortalAccessSnapshot {
  devHub: boolean;
  tenantAdmin: boolean;
}

export function buildHubPortalAccessSnapshot(
  ability: Ability | undefined,
): HubPortalAccessSnapshot {
  return {
    devHub: canAccessDevHub(ability),
    tenantAdmin: canAccessTenantAdmin(ability),
  };
}
