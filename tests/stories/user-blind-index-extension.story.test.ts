import { describe, expect, it } from "vitest";

import {
  buildUserEmailBlindIndexCallbacks,
  buildUserEmailBlindIndexExtension,
} from "../../src/core/auth/user-blind-index.extension.js";
import type { BlindIndex } from "../../src/core/encryption/blind-index.js";

/**
 * Story · `user-email-blind-index` Prisma extension callbacks
 * (iter-160 — coverage uplift on `user-blind-index.extension.ts`).
 *
 * The extension auto-populates `User.emailHash` (HMAC blind index)
 * on every create / update / upsert through the extended Prisma
 * client. The runtime sits behind `Prisma.defineExtension` which
 * is hard to drive from a unit test; iter-160 exposes the
 * callbacks via `buildUserEmailBlindIndexCallbacks` so each branch
 * is exercised directly.
 */
describe("Story · UserEmailBlindIndex extension callbacks (iter-160)", () => {
  function fakeBlindIndex(returnValue: string | null = "hash:OK"): BlindIndex {
    return {
      compute: () => returnValue,
      computeWithKey: () => null,
    } as unknown as BlindIndex;
  }

  describe("create", () => {
    it("stamps emailHash when data.email is a string", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex("hash:abc"));
      let captured: { data?: Record<string, unknown> } | null = null;
      await cbs.create({
        args: { data: { email: "alice@example.com", name: "Alice" } },
        query: async (next) => {
          captured = next;
          return { id: "u1" };
        },
      });
      expect(captured!.data!["emailHash"]).toBe("hash:abc");
      expect(captured!.data!["email"]).toBe("alice@example.com");
      expect(captured!.data!["name"]).toBe("Alice");
    });

    it("leaves emailHash absent when data.email is missing", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex());
      let captured: { data?: Record<string, unknown> } | null = null;
      await cbs.create({
        args: { data: { name: "no-email" } },
        query: async (next) => {
          captured = next;
          return { id: "u1" };
        },
      });
      expect(captured!.data!["emailHash"]).toBeUndefined();
    });

    it("leaves emailHash absent when blindIndex.compute returns null", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex(null));
      let captured: { data?: Record<string, unknown> } | null = null;
      await cbs.create({
        args: { data: { email: "alice@example.com" } },
        query: async (next) => {
          captured = next;
          return { id: "u1" };
        },
      });
      expect(captured!.data!["emailHash"]).toBeUndefined();
    });

    it("handles undefined args.data by stamping nothing", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex());
      let captured: { data?: Record<string, unknown> } | null = null;
      await cbs.create({
        args: {},
        query: async (next) => {
          captured = next;
          return { id: "u1" };
        },
      });
      expect(captured!.data).toEqual({});
    });
  });

  describe("update", () => {
    it("stamps emailHash when the update changes email", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex("hash:new"));
      let captured: { data?: Record<string, unknown> } | null = null;
      await cbs.update({
        args: { data: { email: "new@example.com" } },
        query: async (next) => {
          captured = next;
          return { id: "u1" };
        },
      });
      expect(captured!.data!["emailHash"]).toBe("hash:new");
    });

    it("leaves emailHash absent when the update doesn't touch email", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex());
      let captured: { data?: Record<string, unknown> } | null = null;
      await cbs.update({
        args: { data: { name: "rename only" } },
        query: async (next) => {
          captured = next;
          return { id: "u1" };
        },
      });
      expect(captured!.data!["emailHash"]).toBeUndefined();
    });
  });

  describe("upsert", () => {
    it("stamps both create.emailHash and update.emailHash", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex("hash:both"));
      let captured: {
        create?: Record<string, unknown>;
        update?: Record<string, unknown>;
      } | null = null;
      await cbs.upsert({
        args: {
          create: { email: "create@example.com" },
          update: { email: "update@example.com" },
        },
        query: async (next) => {
          captured = next as typeof captured;
          return { id: "u1" };
        },
      });
      expect(captured!.create!["emailHash"]).toBe("hash:both");
      expect(captured!.update!["emailHash"]).toBe("hash:both");
    });

    it("only stamps create when only the create branch changes email", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex("hash:c"));
      let captured: {
        create?: Record<string, unknown>;
        update?: Record<string, unknown>;
      } | null = null;
      await cbs.upsert({
        args: {
          create: { email: "create@example.com" },
          update: { name: "update only" },
        },
        query: async (next) => {
          captured = next as typeof captured;
          return { id: "u1" };
        },
      });
      expect(captured!.create!["emailHash"]).toBe("hash:c");
      expect(captured!.update!["emailHash"]).toBeUndefined();
    });

    it("does nothing when blindIndex returns null on every email", async () => {
      const cbs = buildUserEmailBlindIndexCallbacks(fakeBlindIndex(null));
      let captured: {
        create?: Record<string, unknown>;
        update?: Record<string, unknown>;
      } | null = null;
      await cbs.upsert({
        args: {
          create: { email: "x@y.com" },
          update: { email: "x@y.com" },
        },
        query: async (next) => {
          captured = next as typeof captured;
          return { id: "u1" };
        },
      });
      expect(captured!.create!["emailHash"]).toBeUndefined();
      expect(captured!.update!["emailHash"]).toBeUndefined();
    });
  });

  describe("buildUserEmailBlindIndexExtension factory", () => {
    it("returns a no-op extension when blindIndex is null", () => {
      const ext = buildUserEmailBlindIndexExtension(null);
      expect(ext).toBeDefined();
    });

    it("returns a configured extension when blindIndex is set", () => {
      const ext = buildUserEmailBlindIndexExtension(fakeBlindIndex());
      expect(ext).toBeDefined();
    });
  });
});
