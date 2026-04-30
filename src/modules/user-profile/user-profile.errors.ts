/**
 * Named error sentinels for the UserProfile module.
 *
 * The profile module's main edge case is "current user has no profile
 * yet" — but that's NOT modelled as an error here, because the
 * service auto-creates an empty profile on first read (lazy-create).
 * That's a deliberate UX choice: a freshly-signed-up user shouldn't
 * see a 404 when GET /me/profile happens before they've ever filled
 * in the form.
 *
 * The remaining error case is "tenant boundary violation" — should
 * never happen because RLS enforces it at the DB layer, but we keep
 * a named sentinel for tests and defense-in-depth assertions.
 */

export class UserProfileTenantMismatchError extends Error {
  constructor(userId: string) {
    super(`UserProfile: tenant mismatch for user ${userId}`);
    this.name = "UserProfileTenantMismatchError";
  }
}
