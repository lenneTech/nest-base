/**
 * Story tests for the slim UserProfile module — exercise the
 * service against the in-memory `FakePrismaService` from
 * `tests/lib/fake-prisma.ts`.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { UpdateUserProfileSchema } from "../../src/modules/user-profile/user-profile.dto.js";
import { UserProfileService } from "../../src/modules/user-profile/user-profile.service.js";
import { asPrismaService, createFakePrisma } from "../lib/fake-prisma.js";

const TENANT_A = "00000000-0000-7000-8000-00000000000a";
const TENANT_B = "00000000-0000-7000-8000-00000000000b";
const USER_ALICE = "11111111-1111-7000-8000-111111111111";
const USER_BOB = "22222222-2222-7000-8000-222222222222";

function makeService(): UserProfileService {
  return new UserProfileService(asPrismaService(createFakePrisma()));
}

describe("Story · UserProfile module", () => {
  let service: UserProfileService;

  beforeEach(() => {
    service = makeService();
  });

  describe("getOrCreate", () => {
    it("creates an empty profile on first read so a fresh user never sees 404", async () => {
      const profile = await service.getOrCreate(TENANT_A, USER_ALICE);
      expect(profile.userId).toBe(USER_ALICE);
      expect(profile.displayName).toBeNull();
      expect(profile.avatarUrl).toBeNull();
      expect(profile.bio).toBeNull();
      expect(profile.phoneNumber).toBeNull();
      expect(profile.preferences).toEqual({});
      expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("is idempotent — second read returns the same profile, doesn't duplicate", async () => {
      const first = await service.getOrCreate(TENANT_A, USER_ALICE);
      const second = await service.getOrCreate(TENANT_A, USER_ALICE);
      expect(second.id).toBe(first.id);
      expect(second.createdAt).toBe(first.createdAt);
    });
  });

  describe("update", () => {
    it("patches only the supplied fields; keeps the rest untouched", async () => {
      await service.update(TENANT_A, USER_ALICE, {
        displayName: "Alice Example",
        bio: "Hello world",
      });
      const updated = await service.update(TENANT_A, USER_ALICE, {
        avatarUrl: "https://cdn.example.test/avatar.png",
      });
      expect(updated.displayName).toBe("Alice Example");
      expect(updated.bio).toBe("Hello world");
      expect(updated.avatarUrl).toBe("https://cdn.example.test/avatar.png");
    });

    it("bumps updatedAt on every patch", async () => {
      const created = await service.getOrCreate(TENANT_A, USER_ALICE);
      await new Promise((r) => setTimeout(r, 2));
      const updated = await service.update(TENANT_A, USER_ALICE, {
        displayName: "Alice",
      });
      expect(updated.updatedAt > created.updatedAt).toBe(true);
    });

    it("replaces preferences as a whole JSON value (not deep-merge)", async () => {
      await service.update(TENANT_A, USER_ALICE, {
        preferences: { theme: "dark", locale: "de" },
      });
      const out = await service.update(TENANT_A, USER_ALICE, {
        preferences: { theme: "light" },
      });
      expect(out.preferences).toEqual({ theme: "light" });
    });

    it("lazy-creates if no profile exists and applies the patch in one round-trip", async () => {
      const out = await service.update(TENANT_B, USER_BOB, {
        displayName: "Bob Newcomer",
      });
      expect(out.userId).toBe(USER_BOB);
      expect(out.displayName).toBe("Bob Newcomer");
    });

    it("accepts null as an explicit clear (e.g. removing a phone number)", async () => {
      await service.update(TENANT_A, USER_ALICE, { phoneNumber: "+49-123" });
      const cleared = await service.update(TENANT_A, USER_ALICE, { phoneNumber: null });
      expect(cleared.phoneNumber).toBeNull();
    });
  });

  describe("DTO schema", () => {
    it("rejects an avatarUrl that isn't a URL", () => {
      const parsed = UpdateUserProfileSchema.safeParse({ avatarUrl: "not-a-url" });
      expect(parsed.success).toBe(false);
    });

    it("accepts a URL avatarUrl", () => {
      const parsed = UpdateUserProfileSchema.safeParse({
        avatarUrl: "https://cdn.example.test/me.png",
      });
      expect(parsed.success).toBe(true);
    });

    it("preferences is a free-form record", () => {
      const parsed = UpdateUserProfileSchema.safeParse({
        preferences: { theme: "dark", widgets: ["a", "b"], counts: { x: 1 } },
      });
      expect(parsed.success).toBe(true);
    });
  });
});
