import { describe, expect, it } from "vitest";

/**
 * Story · Email recipient blocklist (CF.EMAIL.10).
 *
 * The PRD's `CF.EMAIL.10` requires the email layer to consult a
 * blocklist before sending. Reasons we suppress sending include:
 *   - Hard bounce — the address rejected previous mail with a 5xx.
 *   - User unsubscribe — the recipient withdrew consent.
 *   - Operator block — the address belongs to a known abuse pattern
 *     (e.g. `+spam@`, throwaway domain).
 *
 * The planner is pure: given a recipient address + blocklist set,
 * it returns either `{ blocked: false }` or
 * `{ blocked: true, reason }`. The runner (EmailService) consults
 * the planner before invoking the transport.
 *
 * Match rules:
 *   1. Exact match (case-insensitive) on the full address.
 *   2. Domain wildcard: a blocklist entry like `@example.com`
 *      blocks any address with that domain.
 *   3. Sub-address neutralisation: `user+tag@example.com` matches
 *      a blocklist entry for `user@example.com` (tag stripped).
 */
describe("Story · Email recipient blocklist", () => {
  describe("checkRecipientBlocklist — happy paths", () => {
    it("permits send when address is not on the blocklist", async () => {
      const { checkRecipientBlocklist } =
        await import("../../src/core/email/recipient-blocklist.js");
      const result = checkRecipientBlocklist({
        address: "alice@example.com",
        blocklist: [{ pattern: "bob@example.com", reason: "hard-bounce" }],
      });
      expect(result.blocked).toBe(false);
    });

    it("blocks on exact-match address (case-insensitive)", async () => {
      const { checkRecipientBlocklist } =
        await import("../../src/core/email/recipient-blocklist.js");
      const result = checkRecipientBlocklist({
        address: "ALICE@example.com",
        blocklist: [{ pattern: "alice@example.com", reason: "unsubscribe" }],
      });
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.reason).toBe("unsubscribe");
      }
    });

    it("blocks on domain-wildcard entry (@example.com)", async () => {
      const { checkRecipientBlocklist } =
        await import("../../src/core/email/recipient-blocklist.js");
      const result = checkRecipientBlocklist({
        address: "anybody@example.com",
        blocklist: [{ pattern: "@example.com", reason: "domain-block" }],
      });
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.reason).toBe("domain-block");
      }
    });

    it("blocks sub-addressed variants when the canonical is on the list", async () => {
      const { checkRecipientBlocklist } =
        await import("../../src/core/email/recipient-blocklist.js");
      const result = checkRecipientBlocklist({
        address: "alice+marketing@example.com",
        blocklist: [{ pattern: "alice@example.com", reason: "unsubscribe" }],
      });
      expect(result.blocked).toBe(true);
    });

    it("returns the first matching reason when multiple entries match", async () => {
      const { checkRecipientBlocklist } =
        await import("../../src/core/email/recipient-blocklist.js");
      const result = checkRecipientBlocklist({
        address: "alice@example.com",
        blocklist: [
          { pattern: "alice@example.com", reason: "hard-bounce" },
          { pattern: "@example.com", reason: "domain-block" },
        ],
      });
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.reason).toBe("hard-bounce");
      }
    });
  });

  describe("checkRecipientBlocklist — edge cases", () => {
    it("permits send when blocklist is empty", async () => {
      const { checkRecipientBlocklist } =
        await import("../../src/core/email/recipient-blocklist.js");
      expect(
        checkRecipientBlocklist({
          address: "alice@example.com",
          blocklist: [],
        }).blocked,
      ).toBe(false);
    });

    it("rejects malformed addresses without an @ sign", async () => {
      const { checkRecipientBlocklist } =
        await import("../../src/core/email/recipient-blocklist.js");
      const result = checkRecipientBlocklist({
        address: "not-an-email",
        blocklist: [{ pattern: "@example.com", reason: "x" }],
      });
      // Malformed addresses can't be evaluated — the planner blocks
      // them with a dedicated reason rather than letting them through.
      expect(result.blocked).toBe(true);
      if (result.blocked) {
        expect(result.reason).toMatch(/malformed|invalid/i);
      }
    });

    it("normalises domain comparison case-insensitively", async () => {
      const { checkRecipientBlocklist } =
        await import("../../src/core/email/recipient-blocklist.js");
      expect(
        checkRecipientBlocklist({
          address: "alice@EXAMPLE.com",
          blocklist: [{ pattern: "@example.com", reason: "domain-block" }],
        }).blocked,
      ).toBe(true);
    });
  });
});
