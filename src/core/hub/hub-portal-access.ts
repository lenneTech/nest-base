/**
 * CASL helpers for Hub vs Admin operator surfaces (pure functions).
 */
import type { Ability } from "../permissions/casl-ability.js";

/** Cockpit + diagnostics + feature toggles (`/hub/*`). */
export function canAccessDevHub(ability: Ability | undefined): boolean {
  if (!ability) return false;
  return ability.can("manage", "all") || ability.can("read", "DevHub");
}

/** True when the ability grants full CRUD on a subject (DB stores MANAGE expanded). */
function canManageSubject(ability: Ability, subject: string): boolean {
  if (ability.can("manage", subject)) return true;
  return (
    ability.can("create", subject) &&
    ability.can("read", subject) &&
    ability.can("update", subject) &&
    ability.can("delete", subject)
  );
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
