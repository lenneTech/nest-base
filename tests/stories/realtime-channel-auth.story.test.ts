import { describe, expect, it } from "vitest";

import { buildAbility } from "../../src/core/permissions/casl-ability.js";
import {
  canSubscribeToChannel,
  parseChannelName,
} from "../../src/core/realtime/channel-permission.js";

/**
 * Story · Realtime WebSocket Channel Auth.
 *
 * The subscribe handler in `RealtimeGateway.acceptConnection()` now
 * checks CASL abilities before joining a socket to a room. The pure
 * building blocks (`parseChannelName` + `canSubscribeToChannel`) are
 * tested here to document the exact semantics enforced by the gateway:
 *
 *   - Own-tenant channel: allowed when the ability has a matching rule.
 *   - Foreign-tenant channel: always denied (cross-tenant subscription
 *     leak prevention).
 *   - Anonymous / missing ability: denied (secure default).
 */
describe("Story · Realtime channel auth", () => {
  describe("own-tenant channel subscription", () => {
    it("allows subscription to own tenant channel", () => {
      const ability = buildAbility([
        { action: "read", subject: "Project", conditions: { tenantId: "t1" } },
      ]);
      const channel = parseChannelName("Project:tenant:t1");
      expect(canSubscribeToChannel(ability, channel)).toBe(true);
    });

    it("allows subscription to item channel when ability covers the subject", () => {
      const ability = buildAbility([{ action: "read", subject: "Project" }]);
      const channel = parseChannelName("Project:item:abc");
      expect(canSubscribeToChannel(ability, channel)).toBe(true);
    });
  });

  describe("foreign-tenant channel subscription", () => {
    it("denies subscription to a different tenant's channel", () => {
      const ability = buildAbility([
        { action: "read", subject: "Project", conditions: { tenantId: "t1" } },
      ]);
      // Channel belongs to tenant "t2" — user is tenant "t1"
      const channel = parseChannelName("Project:tenant:t2");
      expect(canSubscribeToChannel(ability, channel)).toBe(false);
    });

    it("denies subscription when user has no rules at all", () => {
      const ability = buildAbility([]);
      const channel = parseChannelName("Project:tenant:t1");
      expect(canSubscribeToChannel(ability, channel)).toBe(false);
    });

    it("denies subscription to unrelated subject channel", () => {
      const ability = buildAbility([{ action: "read", subject: "User" }]);
      // User can read User, but not Project
      const channel = parseChannelName("Project:item:abc");
      expect(canSubscribeToChannel(ability, channel)).toBe(false);
    });
  });

  describe("malformed channel names are rejected", () => {
    it("throws on empty string", () => {
      expect(() => parseChannelName("")).toThrow();
    });

    it("throws on channel name without scope/id segments", () => {
      expect(() => parseChannelName("Project")).toThrow();
      expect(() => parseChannelName("Project:item")).toThrow();
    });
  });
});
