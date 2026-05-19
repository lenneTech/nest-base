/**
 * Shared CASL checks for persisted permissions (MANAGE is stored as CRUD).
 */
import type { Ability, AbilityAction, AbilitySubjectType } from "./casl-ability.js";

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
export function abilityAllows(ability: Ability, action: AbilityAction, subject: AbilitySubjectType): boolean {
  if (ability.can(action, subject)) return true;
  if (action === "manage") {
    if (canManageSubject(ability, subject)) return true;
    if (canManageSubject(ability, "all")) return true;
  }
  return false;
}
