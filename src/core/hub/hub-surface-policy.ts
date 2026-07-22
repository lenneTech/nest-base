import type { AppEnv } from "../http/cookie-cors-config.js";

/**
 * Pure policy for hub/admin surface availability across environments.
 *
 * Single source of truth consumed by two thin enforcement points:
 *   - `hub-surface-guard.ts` → controller-level availability asserts
 *     (the `assertDev()` successor)
 *   - `hub-portal.middleware.ts` → session + CASL enforcement for the
 *     non-development opt-in path
 *
 * Two-tier model:
 *   - `operational` — the operator console: cockpit, diagnostics,
 *     feature READ views, user/tenant/role/policy admin, rate-limit
 *     admin, audit browser, admin SPA shells + JSON sidecars. Eligible
 *     outside development when `FEATURE_HUB_ENABLED=true` AND the
 *     request carries an authorized Better-Auth session (middleware).
 *   - `workstation` — tools that read or write the developer's
 *     workstation: source-tree file browser, migrations runner, `.env`
 *     feature toggles, coverage/test-run artifacts, ERD (reads
 *     prisma/ from disk), brand file writes, the x-test-ability
 *     tester, the cross-tenant search tester, the local tunnel state.
 *     These stay development-only FOREVER — no flag, no ability, no
 *     exception. In a deployed container they would leak repo
 *     internals or mutate process/env state, so the conservative
 *     default for any ambiguous surface is this tier.
 */
export type HubSurfaceTier = "operational" | "workstation";

export interface HubSurfaceAvailabilityInput {
  env: AppEnv;
  /** `features.hub.enabled` — the `FEATURE_HUB_ENABLED` opt-in. */
  hubEnabled: boolean;
  tier: HubSurfaceTier;
}

/**
 * Availability of a hub/admin surface for the current environment.
 *
 * development → always available (both tiers; the flag is ignored so
 *               the local workflow can never regress).
 * otherwise   → workstation: never. operational: only when opted in.
 */
export function isHubSurfaceAvailable(input: HubSurfaceAvailabilityInput): boolean {
  if (input.env === "development") return true;
  if (input.tier === "workstation") return false;
  return input.hubEnabled;
}

export interface HubPortalOutsideDevInput {
  /** `features.hub.enabled` — the `FEATURE_HUB_ENABLED` opt-in. */
  hubEnabled: boolean;
  /** True when the session middleware resolved a Better-Auth user. */
  authenticated: boolean;
  /** `/hub/portal-access.json` — the SPA's access probe. */
  isProbePath: boolean;
  /** `/hub/*` pages + JSON (excluding static assets and the probe). */
  isCockpitPath: boolean;
  /** `/admin/*` pages + JSON. */
  isTenantAdminPath: boolean;
  /** `canAccessHub(req.ability)` result. */
  hubAllowed: boolean;
  /** `canAccessTenantAdmin(req.ability)` result. */
  tenantAdminAllowed: boolean;
}

export type HubPortalOutsideDevDecision = "pass-through" | "allow" | "not-found";

/**
 * Middleware decision for hub/admin requests when `env !== development`.
 *
 * - Flag off → `pass-through`: the middleware stays inert and the
 *   controllers keep today's behaviour byte-for-byte (dev-gated routes
 *   404 via the surface guard; the pre-existing @Can-gated admin
 *   surfaces keep their own gates).
 * - Flag on → authentication + CASL become MANDATORY. Anything that is
 *   not an authorized request answers `not-found` — the same 404 a
 *   disabled hub produces, so an unauthorized caller cannot distinguish
 *   an opted-in deployment from one without the flag (no dev-style
 *   redirect, no 403). The probe stays reachable for ANY signed-in
 *   user so the SPA can render its friendly denial screen instead of a
 *   blind 404 (mirrors the probe's development semantics).
 *
 * Anonymous requests normally never reach this decision — the session
 * middleware already 401s/redirects them on protected paths — but a
 * deployment without Better-Auth configured would, so `authenticated`
 * is checked first and masks with `not-found`.
 */
export function evaluateHubPortalRequestOutsideDev(
  input: HubPortalOutsideDevInput,
): HubPortalOutsideDevDecision {
  if (!input.hubEnabled) return "pass-through";
  if (!input.authenticated) return "not-found";
  if (input.isProbePath) return "allow";
  if (input.isCockpitPath && input.hubAllowed) return "allow";
  if (input.isTenantAdminPath && input.tenantAdminAllowed) return "allow";
  return "not-found";
}
