/**
 * Shared CASL checks for persisted permissions (MANAGE is stored as CRUD).
 */
import type { Ability, AbilityAction, AbilitySubjectType } from "./casl-ability.js";

/** CASL subject for operator cockpit routes (`/hub/*`). */
export const HUB_CASL_SUBJECT = "Hub";

/** True when the ability may use Hub portal routes or `@Can(..., "Hub")` handlers. */
export function grantsHubPortalAccess(ability: Ability): boolean {
  if (canManageSubject(ability, "all")) return true;
  return ability.can("read", HUB_CASL_SUBJECT);
}

/** True when the ability grants full CRUD on a subject (DB stores MANAGE expanded). */
export function canManageSubject(ability: Ability, subject: string): boolean {
  if (ability.can("manage", subject)) return true;
  return (
    ability.can("create", subject) &&
    ability.can("read", subject) &&
    ability.can("update", subject) &&
    ability.can("delete", subject)
  );
}

/** `@Can('manage', subject)` with seed-expanded MANAGE and system-admin `all` bypass. */
export function abilityAllows(
  ability: Ability,
  action: AbilityAction,
  subject: AbilitySubjectType,
): boolean {
  if (action === "read" && subject === HUB_CASL_SUBJECT && grantsHubPortalAccess(ability))
    return true;
  if (ability.can(action, subject)) return true;
  if (action === "manage") {
    if (canManageSubject(ability, subject)) return true;
    if (canManageSubject(ability, "all")) return true;
  }
  return false;
}
