/**
 * Repository contract for the UserProfile module.
 *
 * The contract is narrower than `ExampleRepository` because the
 * profile is keyed by `userId` (1:1 with User), not by an arbitrary
 * id. There's no `list` (a user only sees their own profile) and
 * no `delete` (deletion cascades from the User row).
 *
 * Two implementations satisfy the contract:
 *   - `PrismaUserProfileRepository` (default) — real Postgres
 *   - `InMemoryUserProfileRepository` — tests / cold-boot dev
 */

import type { UserProfileRecord } from "./user-profile.types.js";

export interface UserProfileRepository {
  /** Fetch the profile for the given user. Returns null when missing. */
  findByUserId(tenantId: string, userId: string): Promise<UserProfileRecord | null>;

  /** Insert a new profile (used for the lazy-create-on-first-read path). */
  insert(record: UserProfileRecord): Promise<void>;

  /**
   * Apply a partial patch to the profile keyed by userId.
   * The repository does not auto-create — the service handles that.
   * Throws when the profile doesn't exist (caller catches and decides).
   */
  update(
    tenantId: string,
    userId: string,
    patch: Partial<UserProfileRecord>,
  ): Promise<UserProfileRecord>;
}
