import type { PrismaClient } from "@prisma/client";

import type { DbPermissionRow } from "./db-rule-resolver.js";
import { buildMemberRoleRules } from "./member-role-rules.js";
import type { PermissionStorage } from "./permission.service.js";

/**
 * Prisma-backed `PermissionStorage` (closes blocker — replaces the
 * no-op stub that returned `[]` for every user).
 *
 * Two layers stack on every `findRulesForUser(userId, tenantId)`:
 *
 *  1. **Explicit rows** — joined `Role → RolePolicy → Policy →
 *     Permission`, matched by the user's role memberships within the
 *     requested tenant. Authored via the `/admin/*` CRUD UIs.
 *  2. **Implicit "Member" rules** — synthesized in-memory from
 *     `buildMemberRoleRules()` whenever the user has an `ACTIVE`
 *     `TenantMember` row in the requested tenant. Without this layer
 *     a fresh sign-up would 403 on every project-resource route.
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
   * Override the resource list passed to `buildMemberRoleRules()`.
   * Useful for projects that register additional `@Can()` subjects
   * and want them unblocked by default for every member.
   */
  memberResources?: readonly string[];
}

type PrismaSubset = Pick<PrismaClient, "tenantMember" | "permission">;

interface PermissionRow {
  resource: string;
  action: "CREATE" | "READ" | "UPDATE" | "DELETE" | "SHARE";
  itemFilter: unknown;
  fields: string[];
}

export class PrismaPermissionStorage implements PermissionStorage {
  private readonly synthesize: boolean;
  private readonly memberResources?: readonly string[];

  constructor(
    private readonly prisma: PrismaSubset,
    options: PrismaPermissionStorageOptions = {},
  ) {
    this.synthesize = options.synthesizeMemberRules ?? true;
    this.memberResources = options.memberResources;
  }

  async findRulesForUser(userId: string, tenantId: string): Promise<DbPermissionRow[]> {
    // Anonymous-style guard: a user without an ACTIVE membership in
    // the requested tenant has no rules at all. Returning `[]` here
    // is exactly what the previous stub did — the change is that
    // members DO get rules.
    const member = await this.prisma.tenantMember.findFirst({
      where: { userId, tenantId, status: "ACTIVE" },
      select: { id: true, role: true },
    });
    if (!member) return [];

    // Explicit rows: join Role → RolePolicy → Policy → Permission.
    // The user's "role" on the tenant_members row is the role NAME;
    // we match it against `Role.name` scoped to the same tenantId.
    // Querying via the `permission` model with a nested
    // `policy.roles.some.role.{ name, tenantId }` filter keeps the
    // adapter to a single round-trip.
    const explicitRows = (await this.prisma.permission.findMany({
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
    })) as unknown as PermissionRow[];

    const explicit = explicitRows.map(toDbPermissionRow);

    if (!this.synthesize) return explicit;

    // Synthesized: in-memory `manage:<resource>` rules scoped to the
    // active tenant. Appended after the explicit rows so the resolver
    // sees both — CASL OR-merges granting rules.
    const synthesized = buildMemberRoleRules(
      this.memberResources ? { resources: this.memberResources } : {},
    );
    return [...explicit, ...synthesized];
  }
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
