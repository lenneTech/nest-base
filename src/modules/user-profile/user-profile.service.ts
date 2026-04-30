/**
 * UserProfile service — business logic for "extend the User".
 *
 * Slim default: types, errors, and Prisma calls all live in this
 * one file. The service uses `PrismaService` directly via the
 * typed Prisma client (`tx.userProfile.*`).
 *
 * Lazy-create-on-first-read is the key UX choice: a freshly
 * signed-up user calling `GET /me/profile` gets a 200 with empty
 * fields, never a 404. PATCH lazy-creates too, so the frontend
 * never has to choose between POST-then-PATCH and just PATCH.
 */

import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../core/prisma/prisma.service.js";

import type { UpdateUserProfileDto, UserProfileResponse } from "./user-profile.dto.js";

// ── Types ───────────────────────────────────────────────────────────

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
    const now = new Date().toISOString();
    const created = await this.prisma.runWithRlsTenant(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tx as any).userProfile.create({
        data: {
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
        },
      }) as Promise<UserProfileRecord>;
    }, tenantId);
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
    const record = await this.prisma.runWithRlsTenant(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (tx as any).userProfile.update({
        where: { userId },
        data: {
          updatedAt: new Date().toISOString(),
          ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
          ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
          ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
          ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
          ...(dto.preferences !== undefined ? { preferences: dto.preferences } : {}),
        },
      }) as Promise<UserProfileRecord>;
    }, tenantId);
    return toResponse(record);
  }

  // ── Private helpers ───────────────────────────────────────────────

  private async findRaw(tenantId: string, userId: string): Promise<UserProfileRecord | null> {
    return this.prisma.runWithRlsTenant(async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const found = (await (tx as any).userProfile.findUnique({
        where: { userId },
      })) as UserProfileRecord | null;
      // RLS would filter foreign-tenant rows in production; the
      // explicit check guards against the in-memory test fake too.
      return found && found.tenantId === tenantId ? found : null;
    }, tenantId);
  }
}

// ── Mapping ─────────────────────────────────────────────────────────

function toResponse(record: UserProfileRecord): UserProfileResponse {
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
