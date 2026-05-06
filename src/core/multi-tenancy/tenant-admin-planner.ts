/**
 * Tenant admin planner (issue #87).
 *
 * Pure functions that drive the `/admin/tenants` search surface and
 * the tenant stats snapshot. No I/O — keeps the logic testable in
 * isolation without booting NestJS or hitting Prisma.
 *
 * Splitting into planner (here) + runner (tenant-admin.controller.ts)
 * follows the "pure planners over runners" convention in CLAUDE.md.
 */

// ── Filter input / output ────────────────────────────────────────────

export interface TenantAdminSearchInput {
  /** Free-text query; empty string returns all tenants. */
  query: string;
  /** Candidate org rows. */
  orgs: ReadonlyArray<{
    id: string;
    name: string;
    slug: string | null;
    deletedAt: Date | null;
  }>;
  /**
   * Maximum number of results to return. Defaults to 100.
   * Pass a smaller number for a stricter page-size cap.
   */
  limit?: number;
  /**
   * When true, only active (non-deleted) orgs are returned.
   * Mutually exclusive with onlyDeleted.
   */
  onlyActive?: boolean;
  /**
   * When true, only soft-deleted orgs are returned.
   * Mutually exclusive with onlyActive.
   */
  onlyDeleted?: boolean;
}

const DEFAULT_LIMIT = 100;

/**
 * Filter a tenant (Organization) list by a case-insensitive substring
 * match on `name` and `slug`, with optional active/deleted filtering.
 * Returns at most `limit` (default 100) results.
 *
 * The filter is lenient (OR across fields, substring, case-insensitive)
 * to mirror the behaviour of a simple search box in a Dev-Hub admin
 * page. A blank query returns the full list (capped by `limit`).
 */
export function filterTenants(
  input: TenantAdminSearchInput,
): ReadonlyArray<{ id: string; name: string; slug: string | null; deletedAt: Date | null }> {
  const { query, orgs, limit = DEFAULT_LIMIT, onlyActive = false, onlyDeleted = false } = input;
  const needle = query.trim().toLowerCase();

  let candidates = orgs;

  // Apply status filter before text filter to keep result counts intuitive.
  if (onlyActive) {
    candidates = orgs.filter((o) => o.deletedAt === null);
  } else if (onlyDeleted) {
    candidates = orgs.filter((o) => o.deletedAt !== null);
  }

  const matched =
    needle.length === 0 ? candidates : candidates.filter((o) => matchesTenant(o, needle));

  return matched.slice(0, limit);
}

function matchesTenant(org: { name: string; slug: string | null }, needle: string): boolean {
  if (org.name.toLowerCase().includes(needle)) return true;
  if (org.slug !== null && org.slug.toLowerCase().includes(needle)) return true;
  return false;
}

// ── Stats snapshot ────────────────────────────────────────────────────

export interface TenantStatsInput {
  organizationId: string;
  members: ReadonlyArray<{
    id: string;
    organizationId: string;
    userId: string;
    role: string;
    createdAt: Date;
  }>;
  /** Total bytes consumed by tenant-scoped file_blobs. */
  fileSizeBytes: number;
  deletedAt: Date | null;
  createdAt: Date;
}

export interface TenantStats {
  memberCount: number;
  /** Alias for memberCount — 1:1 mapping in this model. */
  userCount: number;
  fileSizeMb: number;
  softDeleted: boolean;
  createdAt: string;
}

/**
 * Compute the stats snapshot for the tenant detail view.
 * Pure — all I/O happens in the controller that calls this.
 */
export function buildTenantStats(input: TenantStatsInput): TenantStats {
  const memberCount = input.members.length;
  const fileSizeMb = input.fileSizeBytes / (1024 * 1024);

  return {
    memberCount,
    userCount: memberCount,
    fileSizeMb,
    softDeleted: input.deletedAt !== null,
    createdAt: input.createdAt.toISOString(),
  };
}
