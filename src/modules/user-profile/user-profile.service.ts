/**
 * UserProfile service — business logic for "extend the User".
 *
 * Slim default: errors and Prisma calls all live in this one file.
 * The service uses `PrismaService` directly via the typed Prisma
 * client (`tx.userProfile.*`).
 *
 * Lazy-create-on-first-read is the key UX choice: a freshly
 * signed-up user calling `GET /me/profile` gets a 200 with empty
 * fields, never a 404. PATCH lazy-creates too, so the frontend
 * never has to choose between POST-then-PATCH and just PATCH.
 */

import { Injectable } from "@nestjs/common";
import type { Prisma, UserProfile } from "@prisma/client";

import { PrismaService } from "../../core/prisma/prisma.service.js";

import type { UpdateUserProfileDto, UserProfileResponse } from "./user-profile.dto.js";

// ── Errors ──────────────────────────────────────────────────────────

export class UserProfileTenantMismatchError extends Error {
  constructor(userId: string) {
    super(`UserProfile: tenant mismatch for user ${userId}`);
    this.name = "UserProfileTenantMismatchError";
  }
}

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class UserProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read the current user's profile. Lazy-creates an empty record
   * the first time, so `GET /me/profile` is always 200.
   */
  async getOrCreate(tenantId: string, userId: string): Promise<UserProfileResponse> {
    const existing = await this.findRaw(tenantId, userId);
    if (existing) return toResponse(existing);
    const created = await this.prisma.runWithRlsTenant(
      (tx) =>
        tx.userProfile.create({
          data: {
            id: crypto.randomUUID(),
            userId,
            tenantId,
            preferences: {},
          },
        }),
      tenantId,
    );
    return toResponse(created);
  }

  /**
   * Patch the current user's profile. Lazy-creates if missing — the
   * first PATCH from a fresh user creates + applies in one call.
   */
  async update(
    tenantId: string,
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponse> {
    await this.getOrCreate(tenantId, userId);
    const record = await this.prisma.runWithRlsTenant(
      (tx) =>
        tx.userProfile.update({
          where: { userId },
          data: {
            ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
            ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
            ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
            ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
            ...(dto.preferences !== undefined
              ? { preferences: dto.preferences as Prisma.InputJsonValue }
              : {}),
          },
        }),
      tenantId,
    );
    return toResponse(record);
  }

  // ── Private helpers ───────────────────────────────────────────────

  private async findRaw(tenantId: string, userId: string): Promise<UserProfile | null> {
    return this.prisma.runWithRlsTenant(async (tx) => {
      const found = await tx.userProfile.findUnique({ where: { userId } });
      // RLS would filter foreign-tenant rows in production; the
      // explicit check guards against the in-memory test fake too.
      return found && found.tenantId === tenantId ? found : null;
    }, tenantId);
  }
}

// ── Mapping ─────────────────────────────────────────────────────────

function toResponse(record: UserProfile): UserProfileResponse {
  // Prisma normalises missing nullable columns to `null`. The
  // `?? null` guards the in-memory test fake, which can return
  // `undefined` for fields the caller didn't pass.
  return {
    id: record.id,
    userId: record.userId,
    displayName: record.displayName ?? null,
    avatarUrl: record.avatarUrl ?? null,
    bio: record.bio ?? null,
    phoneNumber: record.phoneNumber ?? null,
    preferences: (record.preferences ?? {}) as Record<string, unknown>,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
