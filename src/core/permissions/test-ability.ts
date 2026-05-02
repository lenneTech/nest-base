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

/**
 * `NODE_ENV` snapshot captured at module-load time.
 *
 * Specs occasionally flip `process.env.NODE_ENV` mid-suite to test
 * production / development behaviour. When such a spec fails before
 * its `afterAll` reset runs, `NODE_ENV` leaks to every subsequent
 * spec in the same Vitest worker — and the test-ability hatch
 * silently disables itself for the rest of the run, 403'ing every
 * downstream spec that pre-seeds an ability.
 *
 * Caching here means the runtime middleware decision uses the value
 * that was set at import time (which is `"test"` because Vitest's
 * globalSetup runs before any module loads). Runtime mutations of
 * `process.env.NODE_ENV` do NOT change `MODULE_LOAD_NODE_ENV`, so
 * the hatch survives leaked env state.
 *
 * Note: production safety is unaffected. In a real production runtime
 * this module loads with `NODE_ENV=production`, so the cached value
 * is `"production"` and the hatch stays a strict no-op forever.
 */
const MODULE_LOAD_NODE_ENV = process.env.NODE_ENV ?? "";

/**
 * Middleware-facing variant that uses the cached `NODE_ENV`.
 *
 * Equivalent to `parseTestAbilityHeader(rawHeader, MODULE_LOAD_NODE_ENV)`,
 * but exposed as its own export so the call site can't accidentally
 * pass a runtime-mutated value.
 */
export function parseTestAbilityHeaderForRequest(
  rawHeader: string | string[] | undefined,
): Ability | null {
  return parseTestAbilityHeader(rawHeader, MODULE_LOAD_NODE_ENV);
}
