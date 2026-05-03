import type { DbPermissionRow } from "./db-rule-resolver.js";

/**
 * Default "Member" role rules — pure planner.
 *
 * Friction log: a fresh user signed up via Better-Auth gets 403 on
 * every `@Can()`-gated route because the `PERMISSION_STORAGE` returns
 * `[]`. The system has the schema (`Role → RolePolicy → Policy →
 * Permission`) but no out-of-the-box grant that links a tenant
 * member to their tenant's resources.
 *
 * The planner produces a list of synthesized `DbPermissionRow`s for
 * the implicit "Member" role: `manage` on each project resource,
 * scoped to the caller's tenant via `$CURRENT_TENANT`. The rows are
 * NEVER persisted — they are appended in-memory by
 * `PrismaPermissionStorage.findRulesForUser()` whenever the user has
 * an `ACTIVE` `TenantMember` row in the requested tenant.
 *
 * Why not write them to the DB during seed:
 *   - Idempotency at boot — every `@OnModuleInit` would have to keep
 *     this list in sync with project additions.
 *   - Consumers can't easily un-grant the synthesized rules without
 *     re-running a migration; an in-memory rule is a single
 *     `synthesizeMemberRules: false` flag away from being disabled.
 *
 * Why a closed list instead of `'all'`:
 *   - `manage:all` would also cover framework-internal admin
 *     subjects (`Role`, `Policy`, `Permission`, …) which we ship as
 *     admin-only. The closed list is an honest catalogue an auditor
 *     can read at a glance.
 *
 * The action is `MANAGE` (uppercase) so it matches the persisted
 * shape — the resolver lowercases it. Note: `MANAGE` is NOT a value
 * in the `PermissionAction` SQL enum; the rows synthesized here live
 * only in memory and never round-trip through the DB. The CASL
 * ability builder accepts arbitrary action strings (`AbilityAction`
 * is `string`), so `'manage'` becomes the wildcard verb that covers
 * `'read'`, `'create'`, `'update'`, `'delete'`.
 */

/**
 * Project-facing resource subjects the default Member role unblocks.
 *
 * Keep this in sync with the `@Can()` decorators across `src/modules/`
 * and the cross-cutting subjects that real users (not admins) need —
 * specifically excluding admin / framework-only ones (`Role`, `Policy`,
 * `Permission`, `Tenant`, `WebhookEndpoint`, etc.).
 */
export const DEFAULT_MEMBER_RESOURCES = [
  // src/modules/example
  "Example",
  // src/modules/user-profile
  "UserProfile",
  // src/core/files
  "File",
  "Folder",
  // src/core/geo (Address is project-facing — the tenant member
  // typically owns their own postal address)
  "Address",
] as const;

/**
 * Per-user resources the default Member role unblocks.
 *
 * Unlike `DEFAULT_MEMBER_RESOURCES`, these subjects are NOT scoped to
 * the active tenant — they belong to the authenticated user across
 * tenants (`$CURRENT_USER`). The canonical case is `ApiKey`: a user's
 * key works across whichever tenants they're a member of, so a tenant
 * scope would prevent the SDK from listing the keys it can use.
 *
 * Issue #47 added this layer alongside the @Can() audit so the default
 * grant correctly mirrors the per-user nature of the resource.
 */
export const DEFAULT_MEMBER_PER_USER_RESOURCES = [
  // src/core/auth/api-keys — each key belongs to one user; the tenant
  // membership is enforced by the request's tenant header + RLS, not
  // by the ability rule itself.
  "ApiKey",
] as const;

export type DefaultMemberResource = (typeof DEFAULT_MEMBER_RESOURCES)[number];
export type DefaultMemberPerUserResource = (typeof DEFAULT_MEMBER_PER_USER_RESOURCES)[number];

export interface MemberRoleRulesInput {
  /**
   * Override the per-tenant resource list. Useful for project tests
   * that want a minimal fixture, or for projects that ship their
   * own resource catalogue at boot (and pass it via the storage
   * adapter constructor).
   *
   * Pass `[]` to disable per-tenant rules entirely (still emits
   * `perUserResources` rules).
   */
  resources?: readonly string[];

  /**
   * Override the per-user resource list. Defaults to
   * `DEFAULT_MEMBER_PER_USER_RESOURCES` (`ApiKey`).
   */
  perUserResources?: readonly string[];
}

export function buildMemberRoleRules(input: MemberRoleRulesInput = {}): DbPermissionRow[] {
  const tenantResources = input.resources ?? DEFAULT_MEMBER_RESOURCES;
  const userResources = input.perUserResources ?? DEFAULT_MEMBER_PER_USER_RESOURCES;
  const tenantRules: DbPermissionRow[] = tenantResources.map((resource) => ({
    resource,
    // Persisted shape uses uppercase action verbs. `MANAGE` is the
    // CASL-wildcard convention — see the file-level comment.
    action: "MANAGE" as DbPermissionRow["action"],
    // `$CURRENT_TENANT` is substituted by the resolver at request
    // time. The resulting CASL condition matches when the row's
    // `tenantId` equals the caller's active tenant — defense in
    // depth on top of Postgres RLS.
    itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
    fields: [],
  }));
  const userRules: DbPermissionRow[] = userResources.map((resource) => ({
    resource,
    action: "MANAGE" as DbPermissionRow["action"],
    // `$CURRENT_USER` keeps API-key-style resources scoped to the
    // authenticated identity even across tenant boundaries.
    itemFilter: { userId: { _eq: "$CURRENT_USER" } },
    fields: [],
  }));
  return [...tenantRules, ...userRules];
}
