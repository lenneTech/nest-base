import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestHelper } from "../../src/core/testing/test-helper.js";

/**
 * TestHelper provides parallel-safe primitives for E2E/Story tests:
 *  - Unique identifiers (UUID v7)
 *  - Unique emails / handles via `+suffix` (alice+<uuid>@test.com)
 *  - ID-based cleanup registry (no truncate, no global wipes — parallel-safe)
 *
 * The HTTP request wrapper and auth-token injection are wired in later slices
 * once NestJS + Better-Auth land. This slice covers the framework-agnostic
 * surface only.
 */
describe("TestHelper", () => {
  let helper: TestHelper;

  beforeEach(() => {
    helper = new TestHelper();
  });

  afterEach(async () => {
    await helper.cleanup();
  });

  describe("unique identifiers", () => {
    it("uniqueId() returns RFC 9562 UUID v7 (time-ordered, version=7)", () => {
      const a = helper.uniqueId();
      const b = helper.uniqueId();

      expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(b).not.toBe(a);
    });

    it("uniqueEmail() embeds the helper id as plus-suffix for parallel safety", () => {
      const email = helper.uniqueEmail("alice");
      expect(email).toMatch(/^alice\+[0-9a-f-]{36}@test\.com$/);
    });

    it('uniqueEmail() defaults the local part to "user" when none given', () => {
      const email = helper.uniqueEmail();
      expect(email.startsWith("user+")).toBe(true);
      expect(email.endsWith("@test.com")).toBe(true);
    });

    it("two TestHelper instances generate disjoint emails", () => {
      const other = new TestHelper();
      expect(helper.uniqueEmail("x")).not.toBe(other.uniqueEmail("x"));
    });
  });

  describe("cleanup registry", () => {
    it("registerForCleanup() runs callbacks in LIFO order during cleanup()", async () => {
      const order: string[] = [];
      helper.registerForCleanup(async () => {
        order.push("first-registered");
      });
      helper.registerForCleanup(async () => {
        order.push("second-registered");
      });

      await helper.cleanup();

      expect(order).toEqual(["second-registered", "first-registered"]);
    });

    it("cleanup() continues if a callback throws (other entries must still run)", async () => {
      const ran: string[] = [];
      helper.registerForCleanup(async () => {
        ran.push("survives");
      });
      helper.registerForCleanup(async () => {
        throw new Error("boom");
      });

      await expect(helper.cleanup()).resolves.toBeUndefined();
      expect(ran).toEqual(["survives"]);
    });

    it("cleanup() drains the registry — second call is a noop", async () => {
      const fn = vi.fn();
      helper.registerForCleanup(fn);

      await helper.cleanup();
      await helper.cleanup();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("trackId() registers an ID + deleter and runs deleter on cleanup", async () => {
      const deleted: string[] = [];
      const id = helper.uniqueId();

      helper.trackId("User", id, async (entityId) => {
        deleted.push(entityId);
      });

      expect(helper.trackedIds("User")).toEqual([id]);
      await helper.cleanup();
      expect(deleted).toEqual([id]);
      expect(helper.trackedIds("User")).toEqual([]);
    });

    it("trackId() groups multiple IDs under the same resource", async () => {
      const deleted: string[] = [];
      const a = helper.uniqueId();
      const b = helper.uniqueId();

      helper.trackId("User", a, async (entityId) => {
        deleted.push(entityId);
      });
      helper.trackId("User", b, async (entityId) => {
        deleted.push(entityId);
      });

      expect(helper.trackedIds("User")).toEqual([a, b]);
      await helper.cleanup();
      expect(deleted.sort()).toEqual([a, b].sort());
    });
  });
});
