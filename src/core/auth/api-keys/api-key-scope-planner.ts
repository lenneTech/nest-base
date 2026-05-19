import type { Ability } from "../../permissions/casl-ability.js";
import { type AbilityRule, buildAbility } from "../../permissions/casl-ability.js";

/**
 * Pure planner — scoped API-key scope strings → CASL rules + validation.
 *
 * Supports both `action:resource` (`read:profile`) and `resource:action`
 * (`files:read`) forms used across the codebase and story tests.
 */

export class ApiKeyScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyScopeError";
  }
}

/** Canonical scope strings accepted at key issuance. */
export const API_KEY_SCOPE_ALLOWLIST = [
  "read:profile",
  "read:users",
  "write:users",
  "read:example",
  "write:example",
  "files:read",
  "files:write",
  "read:file",
  "write:file",
  "read:folder",
  "write:folder",
  "read:address",
  "write:address",
  "read:invoice",
  "write:invoice",
] as const;

export type ApiKeyScopeString = (typeof API_KEY_SCOPE_ALLOWLIST)[number];

const RESOURCE_TO_SUBJECT: Record<string, string> = {
  profile: "UserProfile",
  users: "User",
  user: "User",
  example: "Example",
  examples: "Example",
  files: "File",
  file: "File",
  folder: "Folder",
  folders: "Folder",
  address: "Address",
  invoice: "Invoice",
};

const READ_ACTIONS = new Set(["read"]);
const WRITE_ACTIONS = new Set(["write", "create", "update", "delete", "manage"]);

export interface ParsedApiKeyScope {
  readonly action: "read" | "manage";
  readonly subject: string;
}

export function validateApiKeyScopes(scopes: readonly string[]): void {
  if (scopes.length === 0) {
    throw new ApiKeyScopeError("api key requires at least one scope");
  }
  const allow = new Set<string>(API_KEY_SCOPE_ALLOWLIST);
  for (const scope of scopes) {
    if (!allow.has(scope)) {
      throw new ApiKeyScopeError(`unknown api key scope "${scope}"`);
    }
  }
}

export function parseApiKeyScope(scope: string): ParsedApiKeyScope | null {
  const parts = scope.split(":");
  if (parts.length !== 2) return null;
  const [left, right] = parts as [string, string];

  if (READ_ACTIONS.has(left) || WRITE_ACTIONS.has(left)) {
    const subject = RESOURCE_TO_SUBJECT[right];
    if (!subject) return null;
    return { action: WRITE_ACTIONS.has(left) ? "manage" : "read", subject };
  }

  if (READ_ACTIONS.has(right) || WRITE_ACTIONS.has(right)) {
    const subject = RESOURCE_TO_SUBJECT[left];
    if (!subject) return null;
    return { action: WRITE_ACTIONS.has(right) ? "manage" : "read", subject };
  }

  return null;
}

export function scopesToAbilityRules(scopes: readonly string[]): AbilityRule[] {
  const rules: AbilityRule[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    const parsed = parseApiKeyScope(scope);
    if (!parsed) continue;
    const key = `${parsed.action}:${parsed.subject}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({
      action: parsed.action,
      subject: parsed.subject,
    });
  }
  return rules;
}

/**
 * Restrict `full` to actions/subjects allowed by `scopes`. When the user's
 * DB rules grant `manage` but the key only allows `read`, the narrowed rule
 * keeps conditions/fields but caps the verb at `read`.
 */
export function restrictAbilityByScopes(full: Ability, scopes: readonly string[]): Ability {
  if (scopes.length === 0) return buildAbility([]);
  const scopeRules = scopesToAbilityRules(scopes);
  const scopeAbility = buildAbility(scopeRules);
  const narrowed: AbilityRule[] = [];

  for (const raw of full.rules) {
    if (raw.inverted) {
      narrowed.push(raw as AbilityRule);
      continue;
    }
    const actions = normalizeList(raw.action);
    const subjects = normalizeList(raw.subject);
    for (const action of actions) {
      for (const subject of subjects) {
        const subjectName = String(subject);
        if (scopeAbility.can("manage", subjectName)) {
          narrowed.push({
            action: raw.action as AbilityRule["action"],
            subject: raw.subject as AbilityRule["subject"],
            ...(raw.conditions ? { conditions: raw.conditions as Record<string, unknown> } : {}),
            ...(raw.fields?.length ? { fields: [...raw.fields] } : {}),
          });
          break;
        }
        if (scopeAbility.can("read", subjectName) && actionMatchesRead(action)) {
          narrowed.push({
            action: "read",
            subject: subjectName,
            ...(raw.conditions ? { conditions: raw.conditions as Record<string, unknown> } : {}),
            ...(raw.fields?.length ? { fields: [...raw.fields] } : {}),
          });
          break;
        }
      }
    }
  }

  return buildAbility(narrowed);
}

function actionMatchesRead(action: string): boolean {
  const lower = action.toLowerCase();
  return lower === "read" || lower === "manage";
}

function normalizeList<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
