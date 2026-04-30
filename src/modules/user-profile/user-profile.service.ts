/**
 * UserProfile service — business logic for "extend the User".
 *
 * Owns:
 *   - lazy-create-on-first-read (`getOrCreate`): a freshly signed-up
 *     user gets an empty profile the first time GET /me/profile fires
 *   - patch semantics for PATCH /me/profile
 *   - mapping records → response DTOs
 *
 * Does NOT own:
 *   - persistence (the repository does)
 *   - id generation for the profile FK target — that's the user
 *     row, owned by Better-Auth. We just store `userId`.
 */

import { Inject, Injectable } from "@nestjs/common";

import type { UpdateUserProfileDto, UserProfileResponse } from "./user-profile.dto.js";
import { toUserProfileResponse } from "./user-profile.mapper.js";
import type { UserProfileRepository } from "./user-profile.repository.js";
import { USER_PROFILE_REPOSITORY } from "./user-profile.tokens.js";
import type { UserProfileRecord } from "./user-profile.types.js";

@Injectable()
export class UserProfileService {
  constructor(
    @Inject(USER_PROFILE_REPOSITORY) private readonly repository: UserProfileRepository,
  ) {}

  /**
   * Read the current user's profile. Lazy-creates an empty record
   * the first time, so `GET /me/profile` is always 200, never 404.
   */
  async getOrCreate(tenantId: string, userId: string): Promise<UserProfileResponse> {
    const existing = await this.repository.findByUserId(tenantId, userId);
    if (existing) return toUserProfileResponse(existing);
    const now = new Date().toISOString();
    const fresh: UserProfileRecord = {
      id: crypto.randomUUID(),
      userId,
      tenantId,
      displayName: null,
      avatarUrl: null,
      bio: null,
      phoneNumber: null,
      preferences: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.insert(fresh);
    return toUserProfileResponse(fresh);
  }

  /**
   * Patch the current user's profile. Lazy-creates if missing — the
   * first PATCH from a fresh user creates + applies in one round-trip.
   */
  async update(
    tenantId: string,
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponse> {
    // Ensure the row exists so the UPDATE actually has something to
    // patch. `getOrCreate` is idempotent — no extra cost on the
    // second-and-later calls.
    await this.getOrCreate(tenantId, userId);
    const patch: Partial<UserProfileRecord> = {
      updatedAt: new Date().toISOString(),
      ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
      ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
      ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
      ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
      ...(dto.preferences !== undefined ? { preferences: dto.preferences } : {}),
    };
    const updated = await this.repository.update(tenantId, userId, patch);
    return toUserProfileResponse(updated);
  }
}
