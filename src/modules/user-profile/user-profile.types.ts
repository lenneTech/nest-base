/**
 * Internal types for the UserProfile module.
 *
 * The profile is a 1:1 extension of the framework-managed User. The
 * `userId` is both the lookup key and the link back to the User row;
 * `id` is a separate primary key so the profile has its own surrogate
 * identity (useful when audit logs reference profile changes).
 *
 * `preferences` is a flexible JSON bucket — projects use it for any
 * settings that don't deserve their own column yet (theme, locale,
 * notification toggles, dashboard layout). When a key in there grows
 * up, promote it to a real column with a migration.
 */

export interface UserProfileRecord {
  id: string;
  userId: string;
  tenantId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  phoneNumber: string | null;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
