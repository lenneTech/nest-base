/**
 * Prisma-backed UserProfileRepository.
 *
 * Patterns to copy when extending other framework-managed entities:
 *
 *   1. **Lookup by foreign key, not by surrogate id** — the row's
 *      surrogate `id` exists for audit / referential identity, but
 *      the natural key is `user_id` (UNIQUE FK to `users.id`).
 *
 *   2. **Tenant column is denormalised** — the column is stored
 *      again on this table even though it could be joined from
 *      `users.tenant_id`. The denormalisation lets RLS fire without
 *      a join, which is the usual win at the cost of a write-time
 *      consistency rule (kept by the service: profile.tenantId
 *      always matches user.tenantId).
 *
 *   3. **JSON columns** — `preferences` is a `JSONB` bucket. Read
 *      returns a parsed object; writes serialise. Postgres handles
 *      the round-trip; we just make sure the type stays
 *      `Record<string, unknown>` on our side.
 */

import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../core/prisma/prisma.service.js";

import type { UserProfileRepository } from "./user-profile.repository.js";
import type { UserProfileRecord } from "./user-profile.types.js";

interface PrismaUserProfileRow {
  id: string;
  userId: string;
  tenantId: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  phoneNumber: string | null;
  preferences: unknown;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PrismaUserProfileRepository implements UserProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(tenantId: string, userId: string): Promise<UserProfileRecord | null> {
    return this.prisma.runWithRlsTenant(async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT id, user_id AS "userId", tenant_id AS "tenantId",
                display_name AS "displayName", avatar_url AS "avatarUrl",
                bio, phone_number AS "phoneNumber", preferences,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM user_profiles WHERE user_id = $1 LIMIT 1`,
        userId,
      )) as PrismaUserProfileRow[];
      const row = rows[0];
      return row ? mapRowToRecord(row) : null;
    }, tenantId);
  }

  async insert(record: UserProfileRecord): Promise<void> {
    await this.prisma.runWithRlsTenant(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO user_profiles (id, user_id, tenant_id, display_name, avatar_url,
                                    bio, phone_number, preferences, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        record.id,
        record.userId,
        record.tenantId,
        record.displayName,
        record.avatarUrl,
        record.bio,
        record.phoneNumber,
        JSON.stringify(record.preferences),
        record.createdAt,
        record.updatedAt,
      );
    }, record.tenantId);
  }

  async update(
    tenantId: string,
    userId: string,
    patch: Partial<UserProfileRecord>,
  ): Promise<UserProfileRecord> {
    return this.prisma.runWithRlsTenant(async (tx) => {
      // Build a dynamic SET clause from the non-undefined patch keys.
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const push = (column: string, value: unknown): void => {
        sets.push(`${column} = $${i++}`);
        values.push(value);
      };
      if (patch.displayName !== undefined) push("display_name", patch.displayName);
      if (patch.avatarUrl !== undefined) push("avatar_url", patch.avatarUrl);
      if (patch.bio !== undefined) push("bio", patch.bio);
      if (patch.phoneNumber !== undefined) push("phone_number", patch.phoneNumber);
      if (patch.preferences !== undefined) {
        // JSONB column — needs an explicit cast.
        sets.push(`preferences = $${i++}::jsonb`);
        values.push(JSON.stringify(patch.preferences));
      }
      // Always bump updated_at.
      push("updated_at", patch.updatedAt ?? new Date().toISOString());
      values.push(userId);

      const rows = (await tx.$queryRawUnsafe(
        `UPDATE user_profiles SET ${sets.join(", ")} WHERE user_id = $${i}
         RETURNING id, user_id AS "userId", tenant_id AS "tenantId",
                   display_name AS "displayName", avatar_url AS "avatarUrl",
                   bio, phone_number AS "phoneNumber", preferences,
                   created_at AS "createdAt", updated_at AS "updatedAt"`,
        ...values,
      )) as PrismaUserProfileRow[];

      const row = rows[0];
      if (!row) throw new Error(`UserProfile: not found for user ${userId}`);
      return mapRowToRecord(row);
    }, tenantId);
  }
}

function mapRowToRecord(row: PrismaUserProfileRow): UserProfileRecord {
  const createdAt =
    row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt);
  const updatedAt =
    row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt);
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    bio: row.bio,
    phoneNumber: row.phoneNumber,
    preferences: parsePreferences(row.preferences),
    createdAt,
    updatedAt,
  };
}

function parsePreferences(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}
