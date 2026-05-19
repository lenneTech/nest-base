/**
 * CASL helpers for Hub vs Admin operator surfaces (pure functions).
 */
import type { Ability } from "../permissions/casl-ability.js";
import { canManageSubject } from "../permissions/ability-subject-access.js";

/** Cockpit + diagnostics + feature toggles (`/hub/*`). */
export function canAccessDevHub(ability: Ability | undefined): boolean {
  if (!ability) return false;
  return canManageSubject(ability, "all") || ability.can("read", "DevHub");
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
