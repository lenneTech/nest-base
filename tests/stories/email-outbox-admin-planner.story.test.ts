import { describe, expect, it } from "vitest";

import {
  parseOutboxListFilter,
  planOutboxAdminAction,
} from "../../src/core/email/email-outbox-action-planner.js";

/**
 * Story · Email-Outbox Admin Action Planner (issue #91).
 *
 * Verifies:
 *  1. State-transition rules for retry and cancel actions.
 *  2. List-filter query-string parser (validation + normalization).
 *
 * All helpers are pure functions — no DB, no Nest bootstrap, no
 * HTTP layer. The controller delegates decisions to these planners
 * so unit tests cover the policy without wiring the module graph.
 */
describe("Story · Email-Outbox Admin Action Planner", () => {
  describe("planOutboxAdminAction()", () => {
    describe("retry action — happy path", () => {
      it("allows retry from pending", () => {
        const result = planOutboxAdminAction("retry", "pending");
        expect(result.allowed).toBe(true);
      });

      it("allows retry from dead-letter", () => {
        const result = planOutboxAdminAction("retry", "dead-letter");
        expect(result.allowed).toBe(true);
      });
    });

    describe("retry action — forbidden paths", () => {
      it("forbids retry from sent", () => {
        const result = planOutboxAdminAction("retry", "sent");
        expect(result.allowed).toBe(false);
        if (!result.allowed) expect(result.reason).toMatch(/already sent/);
      });

      it("forbids retry from cancelled", () => {
        const result = planOutboxAdminAction("retry", "cancelled");
        expect(result.allowed).toBe(false);
        if (!result.allowed) expect(result.reason).toMatch(/cancelled/);
      });
    });

    describe("cancel action — happy path", () => {
      it("allows cancel from pending", () => {
        const result = planOutboxAdminAction("cancel", "pending");
        expect(result.allowed).toBe(true);
      });

      it("allows cancel from dead-letter", () => {
        const result = planOutboxAdminAction("cancel", "dead-letter");
        expect(result.allowed).toBe(true);
      });
    });

    describe("cancel action — forbidden paths", () => {
      it("forbids cancel from sent", () => {
        const result = planOutboxAdminAction("cancel", "sent");
        expect(result.allowed).toBe(false);
        if (!result.allowed) expect(result.reason).toMatch(/already sent/);
      });

      it("forbids cancel from already-cancelled", () => {
        const result = planOutboxAdminAction("cancel", "cancelled");
        expect(result.allowed).toBe(false);
        if (!result.allowed) expect(result.reason).toMatch(/already cancelled/);
      });
    });
  });

  describe("parseOutboxListFilter()", () => {
    it("returns default limit=50 with no input", () => {
      const result = parseOutboxListFilter({});
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.limit).toBe(50);
    });

    it("passes through valid status", () => {
      const result = parseOutboxListFilter({ status: "pending" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.status).toBe("pending");
    });

    it("accepts dead-letter as a valid status", () => {
      const result = parseOutboxListFilter({ status: "dead-letter" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.status).toBe("dead-letter");
    });

    it("accepts cancelled as a valid status", () => {
      const result = parseOutboxListFilter({ status: "cancelled" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.status).toBe("cancelled");
    });

    it("rejects unknown status", () => {
      const result = parseOutboxListFilter({ status: "unknown-status" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/invalid status/);
    });

    it("parses valid ISO dateFrom and dateTo", () => {
      const result = parseOutboxListFilter({
        dateFrom: "2026-01-01T00:00:00Z",
        dateTo: "2026-12-31T23:59:59Z",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.filter.dateFrom).toBeInstanceOf(Date);
        expect(result.filter.dateTo).toBeInstanceOf(Date);
      }
    });

    it("rejects dateFrom after dateTo", () => {
      const result = parseOutboxListFilter({
        dateFrom: "2026-12-31T00:00:00Z",
        dateTo: "2026-01-01T00:00:00Z",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/dateFrom must not be after dateTo/);
    });

    it("rejects invalid date strings", () => {
      const result = parseOutboxListFilter({ dateFrom: "not-a-date" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/invalid dateFrom/);
    });

    it("parses sortBy=attempts", () => {
      const result = parseOutboxListFilter({ sortBy: "attempts" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.sortBy).toBe("attempts");
    });

    it("parses sortBy=time", () => {
      const result = parseOutboxListFilter({ sortBy: "time" });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.sortBy).toBe("time");
    });

    it("rejects invalid sortBy", () => {
      const result = parseOutboxListFilter({ sortBy: "name" });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/invalid sortBy/);
    });

    it("clamps limit between 1 and 200", () => {
      const high = parseOutboxListFilter({ limit: "300" });
      expect(high.ok).toBe(false);
      if (!high.ok) expect(high.reason).toMatch(/limit must be an integer/);

      const low = parseOutboxListFilter({ limit: "0" });
      expect(low.ok).toBe(false);

      const valid = parseOutboxListFilter({ limit: "25" });
      expect(valid.ok).toBe(true);
      if (valid.ok) expect(valid.filter.limit).toBe(25);
    });

    it("trims recipient substring filter", () => {
      const result = parseOutboxListFilter({ recipient: "  user@example.com  " });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.recipient).toBe("user@example.com");
    });

    it("ignores empty recipient", () => {
      const result = parseOutboxListFilter({ recipient: "   " });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.filter.recipient).toBeUndefined();
    });
  });
});
