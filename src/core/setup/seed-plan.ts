import { createHash } from "node:crypto";

/**
 * Pure planner for `bun run seed`.
 *
 * Produces the demo data shape the seed runner upserts via Prisma.
 * The shape gives every downstream slice (permission tester, story
 * tests, manual playing-around) a realistic starting point:
 *   - 1 BA Organization: "Lenne Tech" (slug: "lenne")
 *   - 3 roles: "System Admin" (bypass), "Admin" (manage:org), "User" (read:org)
 *   - 1 policy per role with appropriate permission rows
 *   - 3 users: system-admin@lenne.tech / admin@lenne.tech / user@lenne.tech
 *     (password = email local-part, hashed by the runner via Better-Auth's scrypt)
 *   - 1 UserProfile per user with deterministic placeholder data
 *   - 1 BA Member per user (active, via BA organization table)
 *
 * After issue #118 the canonical tenant layer is Better-Auth's
 * `organization`/`member` tables. The legacy `tenants` / `tenant_members`
 * tables have been dropped (migration 20260508120000_drop_old_tenant_tables).
 *
 * Determinism: every id is derived from a stable seed string via
 * `seededUuidV7()` so the same input → the same output, every run.
 * That means the seed is idempotent: `upsert(id, ...)` matches the
 * existing row, no duplicates accumulate.
 */

// ---------- Public interfaces ----------

export interface SeedRole {
  id: string;
  name: string;
  tenantId: string;
  isSystem: boolean;
  createdAt: Date;
}

export interface SeedPolicy {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
}

export interface SeedRolePolicy {
  roleId: string;
  policyId: string;
}

// `MANAGE` is in-memory only (not a DB PermissionAction enum value) but
// we use it here so the planner output matches the DB enum for real actions
// and uses "MANAGE" for the special CASL wildcard on the bypass row.
export type SeedPermissionAction = "CREATE" | "READ" | "UPDATE" | "DELETE" | "SHARE" | "MANAGE";

export interface SeedPermission {
  id: string;
  policyId: string;
  resource: string;
  action: SeedPermissionAction;
  itemFilter: Record<string, unknown> | null;
  fields: string[];
  createdAt: Date;
}

export interface SeedUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  /** Plain-text password. The runner hashes it before writing to the DB. */
  password: string;
  createdAt: Date;
}

export interface SeedUserProfile {
  id: string;
  userId: string;
  tenantId: string;
  displayName: string;
  createdAt: Date;
}

/**
 * BA Organization row (issue #118).
 *
 * The canonical tenant representation. The legacy `Tenant` model has
 * been removed (migration 20260508120000_drop_old_tenant_tables).
 */
export interface SeedOrganization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

/**
 * BA Member row (issue #118).
 *
 * The canonical membership representation. The legacy `TenantMember`
 * model has been removed (migration 20260508120000_drop_old_tenant_tables).
 */
export interface SeedBaMember {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  createdAt: Date;
}

export interface SeedPlan {
  roles: SeedRole[];
  policies: SeedPolicy[];
  rolePolicies: SeedRolePolicy[];
  permissions: SeedPermission[];
  users: SeedUser[];
  userProfiles: SeedUserProfile[];
  /** BA organization rows — canonical tenant layer (issue #118). */
  organizations: SeedOrganization[];
  /** BA member rows — canonical membership layer (issue #118). */
  baMembers: SeedBaMember[];
}

export interface SeedPlanInput {
  /** Override the wall-clock used for createdAt/joinedAt fields. */
  now?: Date;
}

// ---------- Spec constants ----------

const TENANT_SLUG = "lenne";
const TENANT_NAME = "Lenne Tech";

/**
 * Project-facing resources the Admin and User roles cover. Kept in sync
 * with `DEFAULT_MEMBER_RESOURCES` in `member-role-rules.ts` — the intent
 * is that the seeded roles mirror what the synthesized member rules grant
 * so the seed round-trips correctly in permission tests.
 */
const PROJECT_RESOURCES = ["Example", "UserProfile", "File", "Folder", "Address"] as const;

// ---------- Main builder ----------

export function buildSeedPlan(input: SeedPlanInput = {}): SeedPlan {
  const now = input.now ?? new Date("2026-01-01T00:00:00Z");

  // Stable tenant id derived from the slug — same algorithm as before
  // so existing DB rows keep the same ids across re-seeds.
  const tenantId = seededUuidV7(`tenant:${TENANT_SLUG}`, now);

  // Roles
  const systemAdminRole: SeedRole = {
    id: seededUuidV7(`role:${TENANT_SLUG}:system-admin`, now),
    name: "System Admin",
    tenantId,
    isSystem: true,
    createdAt: now,
  };
  const adminRole: SeedRole = {
    id: seededUuidV7(`role:${TENANT_SLUG}:admin`, now),
    name: "Admin",
    tenantId,
    isSystem: false,
    createdAt: now,
  };
  const userRole: SeedRole = {
    id: seededUuidV7(`role:${TENANT_SLUG}:user`, now),
    name: "User",
    tenantId,
    isSystem: false,
    createdAt: now,
  };
  const roles = [systemAdminRole, adminRole, userRole];

  // Policies — one per role, named after the role
  const systemAdminPolicy: SeedPolicy = {
    id: seededUuidV7(`policy:system-admin`, now),
    name: "System Admin",
    description: "Full bypass — every action on every resource",
    createdAt: now,
  };
  const adminPolicy: SeedPolicy = {
    id: seededUuidV7(`policy:admin`, now),
    name: "Admin",
    description: "Manage all project resources scoped to the current tenant",
    createdAt: now,
  };
  const userPolicy: SeedPolicy = {
    id: seededUuidV7(`policy:user`, now),
    name: "User",
    description: "Read all project resources in tenant; update own User/UserProfile",
    createdAt: now,
  };
  const policies = [systemAdminPolicy, adminPolicy, userPolicy];

  // RolePolicy links
  const rolePolicies: SeedRolePolicy[] = [
    { roleId: systemAdminRole.id, policyId: systemAdminPolicy.id },
    { roleId: adminRole.id, policyId: adminPolicy.id },
    { roleId: userRole.id, policyId: userPolicy.id },
  ];

  // Permissions

  // System Admin: bypass — manage:all, no item filter
  const systemAdminPermissions: SeedPermission[] = [
    {
      id: seededUuidV7(`perm:system-admin:manage:all`, now),
      policyId: systemAdminPolicy.id,
      resource: "all",
      action: "MANAGE",
      itemFilter: null,
      fields: [],
      createdAt: now,
    },
  ];

  // Admin: manage on each project resource, scoped to $CURRENT_TENANT
  const adminPermissions: SeedPermission[] = [
    ...PROJECT_RESOURCES.map((resource) => ({
      id: seededUuidV7(`perm:admin:manage:${resource}`, now),
      policyId: adminPolicy.id,
      resource,
      action: "MANAGE" as SeedPermissionAction,
      itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
      fields: [],
      createdAt: now,
    })),
    {
      id: seededUuidV7(`perm:admin:read:DevHub`, now),
      policyId: adminPolicy.id,
      resource: "DevHub",
      action: "READ",
      itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
      fields: [],
      createdAt: now,
    },
    {
      id: seededUuidV7(`perm:admin:manage:User`, now),
      policyId: adminPolicy.id,
      resource: "User",
      action: "MANAGE",
      itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
      fields: [],
      createdAt: now,
    },
    {
      id: seededUuidV7(`perm:admin:manage:TenantAdmin`, now),
      policyId: adminPolicy.id,
      resource: "TenantAdmin",
      action: "MANAGE",
      itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
      fields: [],
      createdAt: now,
    },
    {
      id: seededUuidV7(`perm:admin:manage:Role`, now),
      policyId: adminPolicy.id,
      resource: "Role",
      action: "MANAGE",
      itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
      fields: [],
      createdAt: now,
    },
    {
      id: seededUuidV7(`perm:admin:manage:Policy`, now),
      policyId: adminPolicy.id,
      resource: "Policy",
      action: "MANAGE",
      itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
      fields: [],
      createdAt: now,
    },
    {
      id: seededUuidV7(`perm:admin:manage:Permission`, now),
      policyId: adminPolicy.id,
      resource: "Permission",
      action: "MANAGE",
      itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
      fields: [],
      createdAt: now,
    },
    {
      id: seededUuidV7(`perm:admin:manage:EmailOutboxAdmin`, now),
      policyId: adminPolicy.id,
      resource: "EmailOutboxAdmin",
      action: "MANAGE",
      itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
      fields: [],
      createdAt: now,
    },
  ];

  // User: READ on each project resource (tenant-scoped)
  //       + UPDATE on User / UserProfile (user-scoped)
  const userReadPermissions: SeedPermission[] = PROJECT_RESOURCES.map((resource) => ({
    id: seededUuidV7(`perm:user:read:${resource}`, now),
    policyId: userPolicy.id,
    resource,
    action: "READ" as SeedPermissionAction,
    itemFilter: { tenantId: { _eq: "$CURRENT_TENANT" } },
    fields: [],
    createdAt: now,
  }));
  const userUpdatePermissions: SeedPermission[] = [
    {
      id: seededUuidV7(`perm:user:update:User`, now),
      policyId: userPolicy.id,
      resource: "User",
      action: "UPDATE",
      // Self-update: item's userId must equal the caller's id.
      itemFilter: { userId: { _eq: "$CURRENT_USER" } },
      fields: [],
      createdAt: now,
    },
    {
      id: seededUuidV7(`perm:user:update:UserProfile`, now),
      policyId: userPolicy.id,
      resource: "UserProfile",
      action: "UPDATE",
      itemFilter: { userId: { _eq: "$CURRENT_USER" } },
      fields: [],
      createdAt: now,
    },
  ];
  const permissions: SeedPermission[] = [
    ...systemAdminPermissions,
    ...adminPermissions,
    ...userReadPermissions,
    ...userUpdatePermissions,
  ];

  // Users — password = local-part of email (hashed by the runner)
  const userSpecs = [
    { localPart: "system-admin", role: "System Admin", displayName: "System Administrator" },
    { localPart: "admin", role: "Admin", displayName: "Tenant Administrator" },
    { localPart: "user", role: "User", displayName: "Demo User" },
  ] as const;

  const users: SeedUser[] = userSpecs.map(({ localPart, displayName: _ }) => ({
    id: seededUuidV7(`user:${TENANT_SLUG}:${localPart}`, now),
    email: `${localPart}@${TENANT_SLUG}.tech`,
    name: localPart
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    emailVerified: true,
    password: localPart,
    createdAt: now,
  }));

  // UserProfiles
  const userProfiles: SeedUserProfile[] = userSpecs.map(({ localPart, displayName }, i) => ({
    id: seededUuidV7(`profile:${TENANT_SLUG}:${localPart}`, now),
    userId: users[i]!.id,
    tenantId,
    displayName,
    createdAt: now,
  }));

  // BA Organization — canonical tenant layer (issue #118).
  const organizations: SeedOrganization[] = [
    { id: tenantId, name: TENANT_NAME, slug: TENANT_SLUG, createdAt: now },
  ];

  // BA Member rows — one active member per user.
  const baMembers: SeedBaMember[] = userSpecs.map(({ localPart, role }, i) => ({
    id: seededUuidV7(`member:${TENANT_SLUG}:${localPart}`, now),
    organizationId: tenantId,
    userId: users[i]!.id,
    role,
    createdAt: now,
  }));

  return {
    roles,
    policies,
    rolePolicies,
    permissions,
    users,
    userProfiles,
    organizations,
    baMembers,
  };
}

// ---------- UUID helpers ----------

/**
 * Deterministic UUID v7 derived from a seed string. Real UUID v7 is
 * `<48 bit timestamp ms><4 bit version><12 bit rand_a><2 bit variant><62 bit rand_b>`.
 * For the seed we keep the timestamp from `now` (so generation order
 * matches a real run) and fill the random portions from a SHA-256 of
 * the seed key. This buys us:
 *   - well-formed UUID v7 (matches the regex /^[0-9a-f]{8}-[0-9a-f]{4}-...{12}$/)
 *   - reproducible across runs given the same key + now
 *   - sortable across the seed (timestamp prefix)
 */
function seededUuidV7(seedKey: string, now: Date): string {
  const ms = BigInt(now.getTime()) & 0xffffffffffffn; // 48 bits
  const tsHex = ms.toString(16).padStart(12, "0");
  const digest = sha256Hex(seedKey);
  // Bits 48-51 = version (`7`).
  const versionAndRandA = `7${digest.slice(0, 3)}`;
  // Bits 64-65 = variant (binary `10` ⇒ first nibble in {8, 9, a, b}).
  // Force first nibble of the third group to 'a'.
  const variantAndRandB = `a${digest.slice(3, 6)}`;
  const tail = digest.slice(6, 18);
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-${versionAndRandA}-${variantAndRandB}-${tail}`;
}

function sha256Hex(input: string): string {
  // Synchronous hash is fine for a planner that runs once at seed time.
  return createHash("sha256").update(input).digest("hex");
}
