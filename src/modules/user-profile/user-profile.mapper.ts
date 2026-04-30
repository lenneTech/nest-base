/**
 * Record → Response mapping for UserProfile.
 *
 * Drops `tenantId` from the wire — the client never sees the tenant
 * boundary; it's an implementation detail of how the server scopes
 * data, not something the user has a use for.
 */

import type { UserProfileResponse } from "./user-profile.dto.js";
import type { UserProfileRecord } from "./user-profile.types.js";

export function toUserProfileResponse(record: UserProfileRecord): UserProfileResponse {
  return {
    id: record.id,
    userId: record.userId,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    bio: record.bio,
    phoneNumber: record.phoneNumber,
    preferences: record.preferences,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
