import { describe, expect, it } from "vitest";

import { buildAbility } from "../../src/core/permissions/casl-ability.js";
import {
  canSubscribeToChannel,
  parseChannelName,
  type ChannelDescriptor,
} from "../../src/core/realtime/channel-permission.js";

/**
 * Story · Realtime Permission-aware Channels.
 *
 * Channel naming convention:
 *   `<resource>:<scope>:<id?>` — e.g. `Project:tenant:t1`,
 *   `Project:item:abc`, `User:item:u1`.
 *
 * The auth-handshake decides if a user may subscribe by reading the
 * cached Ability and matching the channel against the rule's
 * (action='read', subject) tuple.
 */
describe("Story · Realtime channel permission", () => {
  describe("parseChannelName()", () => {
    it("parses subject + scope + id", () => {
      expect(parseChannelName("Project:item:abc")).toEqual({
        subject: "Project",
        scope: "item",
        id: "abc",
      });
    });

    it("parses subject + scope without id (tenant-wide)", () => {
      expect(parseChannelName("Project:tenant:t1")).toEqual({
        subject: "Project",
        scope: "tenant",
        id: "t1",
      });
    });

    it("throws on malformed channel names", () => {
      expect(() => parseChannelName("")).toThrow();
      expect(() => parseChannelName("Project")).toThrow();
      expect(() => parseChannelName("a:b:c:extra")).toThrow();
    });
  });

  describe("canSubscribeToChannel()", () => {
    it('allows when ability.can("read", subject) is true', () => {
      const ability = buildAbility([{ action: "read", subject: "Project" }]);
      const channel: ChannelDescriptor = { subject: "Project", scope: "item", id: "abc" };
      expect(canSubscribeToChannel(ability, channel)).toBe(true);
    });

    it("denies when ability lacks read on subject", () => {
      const ability = buildAbility([{ action: "read", subject: "User" }]);
      const channel: ChannelDescriptor = { subject: "Project", scope: "item", id: "abc" };
      expect(canSubscribeToChannel(ability, channel)).toBe(false);
    });

    it("honors per-item conditions (tenant scope)", () => {
      const ability = buildAbility([
        { action: "read", subject: "Project", conditions: { tenantId: "t1" } },
      ]);
      // Channel scoped to the right tenant
      expect(
        canSubscribeToChannel(ability, { subject: "Project", scope: "tenant", id: "t1" }),
      ).toBe(true);
      // Channel scoped to a different tenant — denied
      expect(
        canSubscribeToChannel(ability, { subject: "Project", scope: "tenant", id: "other" }),
      ).toBe(false);
    });

    it("denies subscription on an empty rule set", () => {
      const ability = buildAbility([]);
      expect(canSubscribeToChannel(ability, { subject: "Project", scope: "item", id: "x" })).toBe(
        false,
      );
    });
  });
});
