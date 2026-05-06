import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  RealtimeChannel,
  getRealtimeChannelMetadata,
  getRegisteredRealtimeChannels,
  resetRealtimeChannelRegistryForTests,
} from "../../src/core/realtime/realtime-channel.decorator.js";

/**
 * Story · `@RealtimeChannel` decorator + registry (CF.REALTIME.04).
 *
 * The PRD pins "@RealtimeChannel decorator + permission filter".
 * Project code declares its emittable channels at one well-known
 * location; the realtime gateway's permission filter consults the
 * registry on every subscribe + broadcast.
 *
 * Channel-name grammar (mirrors the existing channel-permission
 * planner): dot-separated lowercase segments, with `{tenantId}` /
 * `{userId}`-style placeholders the gateway resolves at subscribe
 * time.
 *
 * Validation surface:
 *   - `name` required + non-empty
 *   - `name` is dot-separated lowercase / `{token}` segments
 *   - `description` non-empty when provided
 *   - `version` is a positive integer when provided
 *   - `permission.resource` + `permission.action` both required when permission supplied
 *   - duplicate names on different classes throw at decoration time
 */
describe("Story · @RealtimeChannel decorator", () => {
  beforeEach(() => {
    resetRealtimeChannelRegistryForTests();
  });
  afterEach(() => {
    resetRealtimeChannelRegistryForTests();
  });

  describe("happy path", () => {
    it("attaches metadata to the class + registers it globally", () => {
      @RealtimeChannel({
        name: "tenant.{tenantId}",
        description: "Per-tenant fanout",
        permission: { resource: "Tenant", action: "read" },
      })
      class TenantStream {}
      const meta = getRealtimeChannelMetadata(TenantStream);
      expect(meta).toBeDefined();
      expect(meta?.name).toBe("tenant.{tenantId}");
      expect(meta?.description).toBe("Per-tenant fanout");
      expect(meta?.version).toBe(1);
      expect(meta?.permission).toEqual({ resource: "Tenant", action: "read" });
      expect(getRegisteredRealtimeChannels()).toHaveLength(1);
    });

    it("accepts placeholder-free channel names (system-wide broadcast)", () => {
      @RealtimeChannel({ name: "system.broadcast", description: "Global fanout" })
      class System {}
      expect(getRealtimeChannelMetadata(System)?.name).toBe("system.broadcast");
    });

    it("accepts hierarchical names with placeholders", () => {
      @RealtimeChannel({ name: "user.{userId}.notifications" })
      class Inbox {}
      expect(getRealtimeChannelMetadata(Inbox)?.name).toBe("user.{userId}.notifications");
    });

    it("permission is null when omitted (channel is publicly subscribable)", () => {
      @RealtimeChannel({ name: "system.health" })
      class Health {}
      expect(getRealtimeChannelMetadata(Health)?.permission).toBeNull();
    });
  });

  describe("name validation", () => {
    it("rejects empty / whitespace name", () => {
      expect(() => RealtimeChannel({ name: "" })).toThrow(/required/);
      expect(() => RealtimeChannel({ name: "   " })).toThrow(/required/);
    });

    it("rejects uppercase / no-dot / leading-dot names", () => {
      expect(() => RealtimeChannel({ name: "Tenant.feed" })).toThrow(/dot-separated/);
      expect(() => RealtimeChannel({ name: "tenantfeed" })).toThrow(/dot-separated/);
      expect(() => RealtimeChannel({ name: ".feed" })).toThrow(/dot-separated/);
    });
  });

  describe("description validation", () => {
    it("rejects empty-string description", () => {
      expect(() => RealtimeChannel({ name: "x.y", description: "" })).toThrow(/non-empty/);
      expect(() => RealtimeChannel({ name: "x.y", description: "   " })).toThrow(/non-empty/);
    });
  });

  describe("version validation", () => {
    it("rejects non-positive / non-integer versions", () => {
      expect(() => RealtimeChannel({ name: "x.y", version: 0 })).toThrow(/positive integer/);
      expect(() => RealtimeChannel({ name: "x.y", version: -1 })).toThrow(/positive integer/);
      expect(() => RealtimeChannel({ name: "x.y", version: 1.5 })).toThrow(/positive integer/);
    });
  });

  describe("permission validation", () => {
    it("rejects empty resource / action when permission supplied", () => {
      expect(() =>
        RealtimeChannel({ name: "x.y", permission: { resource: "", action: "read" } }),
      ).toThrow(/permission\.resource/);
      expect(() =>
        RealtimeChannel({ name: "x.y", permission: { resource: "X", action: "" } }),
      ).toThrow(/permission\.action/);
    });
  });

  describe("registry semantics", () => {
    it("rejects duplicate channel names on different classes", () => {
      const decorate = RealtimeChannel({ name: "tenant.feed" });
      class A {}
      class B {}
      decorate(A);
      expect(() => decorate(B)).toThrow(/duplicate channel name/);
    });

    it("re-decorating the SAME class is idempotent (hot reload)", () => {
      class A {}
      const decorate = RealtimeChannel({ name: "tenant.feed" });
      decorate(A);
      expect(() => decorate(A)).not.toThrow();
    });

    it("getRegisteredRealtimeChannels returns channels sorted by name", () => {
      @RealtimeChannel({ name: "z.last" })
      class Z {}
      @RealtimeChannel({ name: "a.first" })
      class A {}
      @RealtimeChannel({ name: "m.middle" })
      class M {}
      void Z;
      void A;
      void M;
      const list = getRegisteredRealtimeChannels();
      expect(list.map((c) => c.name)).toEqual(["a.first", "m.middle", "z.last"]);
    });

    it("getRegisteredRealtimeChannels returns an immutable snapshot", () => {
      @RealtimeChannel({ name: "x.y" })
      class X {}
      void X;
      const snapshot = getRegisteredRealtimeChannels();
      const before = snapshot.length;
      // Mutating the returned array does not affect subsequent reads.
      const writable = snapshot as unknown as Array<{ name: string }>;
      writable.push({ name: "z.fake" });
      const after = getRegisteredRealtimeChannels().length;
      expect(after).toBe(before);
    });
  });
});
