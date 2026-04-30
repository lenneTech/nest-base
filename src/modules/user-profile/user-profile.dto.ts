/**
 * UserProfile DTOs — Zod schemas as the single source of truth.
 *
 * The profile has no `Create` schema because creation is implicit:
 * the service auto-provisions an empty profile on first read. The
 * client only ever reads or patches.
 */

import { z } from "zod";

/** Body for PATCH /me/profile. Every field optional. */
export const UpdateUserProfileSchema = z.object({
  displayName: z.string().max(255).nullable().optional(),
  avatarUrl: z.url().max(2048).nullable().optional(),
  bio: z.string().max(2000).nullable().optional(),
  phoneNumber: z.string().max(50).nullable().optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateUserProfileDto = z.infer<typeof UpdateUserProfileSchema>;

/** Public response shape. */
export const UserProfileResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  bio: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  preferences: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserProfileResponse = z.infer<typeof UserProfileResponseSchema>;
