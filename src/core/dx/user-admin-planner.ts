/**
 * User admin planner (issue #86).
 *
 * Pure functions that drive the `/admin/users` search surface.
 * No I/O — keeps the logic testable in isolation without booting
 * NestJS or hitting Prisma.
 *
 * Splitting into planner (here) + runner (user-admin.controller.ts)
 * follows the same pattern as `sessions-admin.planner.ts` and the
 * broader "pure planners over runners" convention in CLAUDE.md.
 */

export interface UserAdminSearchInput {
  /** Free-text query; empty string returns all users. */
  query: string;
  /** Candidate user rows. */
  users: ReadonlyArray<{ id: string; email: string; name: string | null; banned: boolean }>;
  /**
   * Maximum number of results to return. Defaults to 50.
   * Pass a smaller number for a stricter page-size cap.
   */
  limit?: number;
}

const DEFAULT_LIMIT = 50;

/**
 * Filter a user list by a case-insensitive substring match on
 * `email` and `name`. Returns at most `limit` (default 50) results.
 *
 * The filter is intentionally lenient (OR across fields, substring,
 * case-insensitive) to mirror the behaviour of a simple search box
 * in a Dev-Hub admin page. A blank query returns the full list
 * (capped by `limit`).
 */
export function filterUsers(
  input: UserAdminSearchInput,
): ReadonlyArray<{ id: string; email: string; name: string | null; banned: boolean }> {
  const { query, users, limit = DEFAULT_LIMIT } = input;
  const needle = query.trim().toLowerCase();

  const matched = needle.length === 0 ? users : users.filter((u) => matchesUser(u, needle));

  return matched.slice(0, limit);
}

function matchesUser(user: { email: string; name: string | null }, needle: string): boolean {
  if (user.email.toLowerCase().includes(needle)) return true;
  if (user.name !== null && user.name.toLowerCase().includes(needle)) return true;
  return false;
}
