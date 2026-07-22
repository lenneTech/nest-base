import type { PrismaClient } from "@prisma/client";

import type { DbPermissionRow } from "./db-rule-resolver.js";
import {
  DEFAULT_MEMBER_PER_USER_RESOURCES,
  DEFAULT_MEMBER_RESOURCES,
  buildMemberRoleRules,
} from "./member-role-rules.js";
import type { PermissionStorage } from "./permission.service.js";

/**
 * Prisma-backed `PermissionStorage` (closes blocker — replaces the
 * no-op fake that returned `[]` for every user).
 *
 * Two layers stack on every `findRulesForUser(userId, tenantId)`:
 *
 *  1. **Explicit rows** — joined `Role → RolePolicy → Policy →
 *     Permission`, matched by the user's role memberships within the
 *     requested tenant. Authored via the `/hub/admin/*` CRUD UIs.
 *  2. **Implicit "Member" rules** — synthesized in-memory from
 *     `buildMemberRoleRules()` whenever the user has a `member` row in
 *     the requested organization (BA stores only active members, so
 *     presence implies ACTIVE). Without this layer a fresh sign-up
 *     would 403 on every project-resource route.
 *
 * The synthesized rules are NEVER written to the DB. They live for
 * the duration of the request (and the 60s `PermissionService`
 * cache), so projects retain full control of "what does Member mean
 * for us" — set `synthesizeMemberRules: false` and seed your own
 * Member role explicitly.
 *
 * Anonymous users (no membership row) get an empty list — the
 * existing `CanGuard` "deny on unmatched rule" behaviour is
 * preserved, no escalation path is opened.
 *
 * Defense in depth: this adapter *only* trusts the (userId, tenantId)
 * pair the request resolver already validated upstream
 * (`BetterAuthSessionMiddleware` → `req.user`, `TenantInterceptor` →
 * `getCurrentTenantId()`). The synthesized member rules carry a
 * `$CURRENT_TENANT` filter so even if the upstream resolver mismixed
 * a tenant, CASL still scopes to the resolved id.
 */

export interface PrismaPermissionStorageOptions {
  /**
   * When true (default), every `ACTIVE` tenant member receives the
   * default `manage` rules from `buildMemberRoleRules()` on top of
   * any explicit Role/Policy/Permission rows.
   *
   * Set to `false` if your project ships its own seeded Member role
   * — the explicit DB rows then become the single source of truth.
   */
  synthesizeMemberRules?: boolean;
  /**
   * Override the per-tenant resource list passed to
   * `buildMemberRoleRules()`. Useful for projects that register
   * additional `@Can()` subjects and want them unblocked by default
   * for every member.
   */
  memberResources?: readonly string[];
  /**
   * Override the per-user resource list (Issue #47 — `ApiKey` scoped
   * to `$CURRENT_USER` rather than `$CURRENT_TENANT`). Empty array
   * disables the default `ApiKey` grant entirely.
   */
  memberPerUserResources?: readonly string[];
}

/**
 * Multi-provider extras (`EXTRA_MEMBER_RESOURCES` /
 * `EXTRA_MEMBER_PER_USER_RESOURCES`) the storage should merge on top
 * of the (possibly-overridden) defaults. NestJS multi-providers
 * surface as `T[]` where each `T` is one provider's `useValue` — so
 * here `string[][]`, one inner array per registration.
 *
 * Kept as a separate parameter (instead of folded into
 * `PrismaPermissionStorageOptions`) so projects that construct the
 * storage manually for tests don't have to deal with the multi-
 * provider shape — only the `PermissionsModule` factory wires it.
 */
export interface PrismaPermissionStorageExtras {
  extraTenantResources?: readonly (readonly string[])[];
  extraUserResources?: readonly (readonly string[])[];
}

type PrismaSubset = Pick<PrismaClient, "member" | "permission">;

interface PermissionRow {
  resource: string;
  action: "CREATE" | "READ" | "UPDATE" | "DELETE" | "SHARE";
  itemFilter: unknown;
  fields: string[];
}

export class PrismaPermissionStorage implements PermissionStorage {
  private readonly synthesize: boolean;
  private readonly memberResources?: readonly string[];
  private readonly memberPerUserResources?: readonly string[];
  private readonly extraTenantResources: readonly string[];
  private readonly extraUserResources: readonly string[];

  constructor(
    private readonly prisma: PrismaSubset,
    options: PrismaPermissionStorageOptions = {},
    extras: PrismaPermissionStorageExtras = {},
  ) {
    this.synthesize = options.synthesizeMemberRules ?? true;
    this.memberResources = options.memberResources;
    this.memberPerUserResources = options.memberPerUserResources;
    // Flat-map the multi-provider arrays once at construction so the
    // hot path in findRulesForUser stays cheap. Stable-sort the
    // result so multiple providers contributing the same set produce
    // a deterministic order (the sort is on the extras only — the
    // defaults retain their authored order so existing snapshots
    // / consumers that depend on it stay stable).
    this.extraTenantResources = stableUniqueSort(extras.extraTenantResources);
    this.extraUserResources = stableUniqueSort(extras.extraUserResources);
  }

  async findRulesForUser(userId: string, tenantId: string): Promise<DbPermissionRow[]> {
    // Anonymous-style guard: a user without a membership row in the
    // requested organization has no rules at all. BA's `member` table
    // only stores active members, so a found row implies ACTIVE status.
    const member = await this.prisma.member.findFirst({
      where: { userId, organizationId: tenantId },
      select: { id: true, role: true },
    });
    if (!member) return [];

    // Explicit rows: join Role → RolePolicy → Policy → Permission.
    // The user's "role" on the tenant_members row is the role NAME;
    // we match it against `Role.name` scoped to the same tenantId.
    // Querying via the `permission` model with a nested
    // `policy.roles.some.role.{ name, tenantId }` filter keeps the
    // adapter to a single round-trip.
    // The Prisma `findMany` typed return is the per-model row shape
    // with the selected columns; the project's `PermissionRow` is
    // structurally identical but rides through a hand-rolled
    // interface so adapters don't depend on Prisma generics. Bridge
    // through a typed `unknown` intermediate.
    const explicitRowsErased: unknown = await this.prisma.permission.findMany({
      where: {
        policy: {
          roles: {
            some: {
              role: {
                name: member.role,
                tenantId,
              },
            },
          },
        },
      },
      select: {
        resource: true,
        action: true,
        itemFilter: true,
        fields: true,
      },
    });
    const explicitRows = explicitRowsErased as PermissionRow[];

    const explicit = explicitRows.map(toDbPermissionRow);

    if (!this.synthesize) return explicit;

    // Synthesized: in-memory `manage:<resource>` rules — tenant-scoped
    // entries use `$CURRENT_TENANT`, per-user entries (ApiKey, etc.)
    // use `$CURRENT_USER`. Appended after the explicit rows so the
    // resolver sees both — CASL OR-merges granting rules.
    //
    // Merge order: explicit overrides (memberResources /
    // memberPerUserResources) take precedence for the "default" slot,
    // then EXTRA_* multi-provider extras append after, deduped.
    // Without an override the upstream defaults apply.
    const tenantBase = this.memberResources ?? DEFAULT_MEMBER_RESOURCES;
    const userBase = this.memberPerUserResources ?? DEFAULT_MEMBER_PER_USER_RESOURCES;
    const opts: Parameters<typeof buildMemberRoleRules>[0] = {
      resources: dedupePreserveOrder(tenantBase, this.extraTenantResources),
      perUserResources: dedupePreserveOrder(userBase, this.extraUserResources),
    };
    const synthesized = buildMemberRoleRules(opts);
    return [...explicit, ...synthesized];
  }
}

/**
 * Flatten + dedupe + stable-sort a multi-provider extras list. The
 * sort is intentional: two providers registering the same set must
 * produce a deterministic order so cached abilities stay stable.
 *
 * We do NOT touch the order of the upstream defaults — those are
 * authored deliberately in `member-role-rules.ts` and merged after
 * via `dedupePreserveOrder`.
 */
function stableUniqueSort(source: readonly (readonly string[])[] | undefined): readonly string[] {
  if (!source || source.length === 0) return [];
  return [...new Set(source.flat())].sort();
}

/**
 * Concatenate `defaults` then `extras` and dedupe by keeping the
 * first occurrence. Defaults retain their authored order so
 * downstream consumers that depend on it (existing tests, the
 * `/permissions/test` endpoint snapshot) stay stable; extras append
 * in their stable-sorted order.
 */
function dedupePreserveOrder(
  defaults: readonly string[],
  extras: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...defaults, ...extras]) {
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function toDbPermissionRow(row: PermissionRow): DbPermissionRow {
  return {
    resource: row.resource,
    action: row.action,
    // Prisma's `Json?` column comes back as an unknown value — narrow
    // to `Record<string, unknown> | null` so the resolver can consume
    // it without an extra cast.
    itemFilter:
      row.itemFilter && typeof row.itemFilter === "object" && !Array.isArray(row.itemFilter)
        ? (row.itemFilter as Record<string, unknown>)
        : null,
    fields: row.fields,
  };
}
