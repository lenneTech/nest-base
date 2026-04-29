import { type Ability, type AbilityRule, buildAbility } from "./casl-ability.js";

/**
 * Pure planner for the test-ability hatch.
 *
 * E2E specs that hit a `@Can()`-gated route would normally have to
 * drive the full Better-Auth sign-in flow just to seed the request
 * with an Ability. That's a lot of plumbing for tests whose subject
 * is the controller behaviour, not the auth flow. This helper lets
 * specs send an `X-Test-Ability` header and pre-seed the request
 * directly — but ONLY when `NODE_ENV === "test"`. Outside test
 * mode the helper always returns null, so the header is a no-op in
 * dev/staging/production and can never become a privilege-escalation
 * vector.
 *
 * Header value contract:
 *
 *   - `"full"`     → `manage:all` (admin-equivalent ability)
 *   - JSON array   → list of `AbilityRule` objects
 *                    e.g. `[{ "action": "read", "subject": "Project" }]`
 *   - anything else → null (caller falls through to the regular
 *                     `PermissionInterceptor` path)
 *
 * Returns `null` on any failure (missing header, wrong env,
 * malformed JSON, non-array payload). The runner never throws.
 */

export function parseTestAbilityHeader(
  rawHeader: string | string[] | undefined,
  nodeEnv: string,
): Ability | null {
  if (nodeEnv !== "test") return null;
  const value = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!value) return null;

  if (value === "full") {
    return buildAbility([{ action: "manage", subject: "all" }]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const rules: AbilityRule[] = [];
  for (const entry of parsed) {
    if (!isAbilityRule(entry)) return null;
    rules.push(entry);
  }
  return buildAbility(rules);
}

function isAbilityRule(value: unknown): value is AbilityRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  if (typeof r.action !== "string" && !Array.isArray(r.action)) return false;
  if (typeof r.subject !== "string" && !Array.isArray(r.subject)) return false;
  return true;
}
