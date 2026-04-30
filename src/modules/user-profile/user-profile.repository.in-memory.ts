/**
 * In-memory UserProfileRepository — tests + cold-boot dev fallback.
 *
 * Same contract as the Prisma implementation; tenant isolation is
 * implemented by hand here (filter by `tenantId` on every read /
 * write). Production gets the equivalent for free via RLS.
 */

import { Injectable } from "@nestjs/common";

import type { UserProfileRepository } from "./user-profile.repository.js";
import type { UserProfileRecord } from "./user-profile.types.js";

@Injectable()
export class InMemoryUserProfileRepository implements UserProfileRepository {
  // Keyed by userId because that's the natural lookup key (1:1).
  private readonly byUserId = new Map<string, UserProfileRecord>();

  async findByUserId(tenantId: string, userId: string): Promise<UserProfileRecord | null> {
    const record = this.byUserId.get(userId);
    return record && record.tenantId === tenantId ? record : null;
  }

  async insert(record: UserProfileRecord): Promise<void> {
    this.byUserId.set(record.userId, record);
  }

  async update(
    tenantId: string,
    userId: string,
    patch: Partial<UserProfileRecord>,
  ): Promise<UserProfileRecord> {
    const existing = this.byUserId.get(userId);
    if (!existing || existing.tenantId !== tenantId) {
      throw new Error(`UserProfile: not found for user ${userId}`);
    }
    const next: UserProfileRecord = { ...existing, ...patch };
    this.byUserId.set(userId, next);
    return next;
  }
}
