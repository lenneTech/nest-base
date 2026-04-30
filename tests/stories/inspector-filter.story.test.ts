import { describe, expect, it } from "vitest";

import {
  filterSockets,
  maskPayload,
  parseChannelPattern,
  type InspectorSocketEntry,
} from "../../src/core/realtime/inspector-filter.js";

/**
 * Story · Realtime Inspector Filter + Payload-Masking.
 *
 * Two pure helpers used by the admin live-push namespace and by the
 * `/admin/realtime*` JSON sidecars:
 *
 *  - `parseChannelPattern(input)` — turns a user-typed channel pattern
 *    into a RegExp. `*` wildcards become `.*`, the rest is escaped.
 *    Returns `null` for an empty input so callers can treat missing
 *    pattern as "match everything".
 *  - `filterSockets(sockets, criteria)` — narrows the snapshot by
 *    tenant, user-id substring, and channel pattern.
 *  - `maskPayload(payload, opts?)` — defends privacy: known PII keys
 *    (`email`, `password`, `token`, `secret`, `authorization`,
 *    `phone`, `ssn`) get redacted; long strings are truncated. The
 *    inspector calls this on every payload before broadcasting it to
 *    the admin namespace.
 */
describe("Story · Inspector Filter + Masking", () => {
  describe("parseChannelPattern()", () => {
    it("returns null for empty input", () => {
      expect(parseChannelPattern("")).toBeNull();
      expect(parseChannelPattern("   ")).toBeNull();
    });

    it("translates `*` wildcards to `.*` and escapes the rest", () => {
      const re = parseChannelPattern("Project:tenant:*")!;
      expect(re).toBeInstanceOf(RegExp);
      expect(re.test("Project:tenant:t1")).toBe(true);
      expect(re.test("Project:tenant:other")).toBe(true);
      expect(re.test("Asset:tenant:t1")).toBe(false);
    });

    it("anchors the regex (full match only)", () => {
      const re = parseChannelPattern("Project:tenant:t1")!;
      expect(re.test("Project:tenant:t1")).toBe(true);
      // No partial match.
      expect(re.test("xProject:tenant:t1")).toBe(false);
      expect(re.test("Project:tenant:t1x")).toBe(false);
    });

    it("escapes regex special chars to prevent injection", () => {
      const re = parseChannelPattern(".*+?(){}[]^$|")!;
      // The literal string with the escaped specials should match itself.
      expect(re.test(".*+?(){}[]^$|")).toBe(true);
      // But not arbitrary content.
      expect(re.test("anything")).toBe(false);
    });
  });

  describe("filterSockets()", () => {
    function s(overrides: Partial<InspectorSocketEntry>): InspectorSocketEntry {
      return {
        id: "s",
        userId: "u",
        tenantId: "t",
        channels: [],
        connectedAt: new Date(0).toISOString(),
        bytesSent: 0,
        bytesReceived: 0,
        ...overrides,
      };
    }

    it("returns the full list when all filters are empty", () => {
      const list = [s({ id: "s1" }), s({ id: "s2" })];
      expect(filterSockets(list, {})).toHaveLength(2);
    });

    it("filters by tenantId (exact match)", () => {
      const list = [s({ id: "s1", tenantId: "t1" }), s({ id: "s2", tenantId: "t2" })];
      const result = filterSockets(list, { tenantId: "t1" });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("s1");
    });

    it("filters by userId (substring, case-insensitive)", () => {
      const list = [s({ id: "s1", userId: "alice" }), s({ id: "s2", userId: "bob" })];
      expect(filterSockets(list, { userId: "ALI" })).toHaveLength(1);
    });

    it("filters by channel pattern", () => {
      const list = [
        s({ id: "s1", channels: ["Project:tenant:t1"] }),
        s({ id: "s2", channels: ["Asset:tenant:t1"] }),
      ];
      expect(filterSockets(list, { channelPattern: "Project:*" })).toHaveLength(1);
    });

    it("malformed channel pattern is ignored (treated as no filter)", () => {
      const list = [s({ id: "s1", channels: [] })];
      // An empty pattern means "no filter".
      expect(filterSockets(list, { channelPattern: "" })).toHaveLength(1);
    });

    it("AND-combines multiple criteria", () => {
      const list = [
        s({ id: "s1", tenantId: "t1", userId: "alice", channels: ["Project:tenant:t1"] }),
        s({ id: "s2", tenantId: "t1", userId: "bob", channels: ["Project:tenant:t1"] }),
        s({ id: "s3", tenantId: "t2", userId: "alice", channels: ["Project:tenant:t2"] }),
      ];
      const result = filterSockets(list, {
        tenantId: "t1",
        userId: "alice",
        channelPattern: "Project:*",
      });
      expect(result).toHaveLength(1);
      expect(result[0]!.id).toBe("s1");
    });
  });

  describe("maskPayload()", () => {
    it("redacts known PII keys at any depth", () => {
      const payload = {
        user: { email: "alice@example.com", id: "u1" },
        password: "topsecret",
        nested: { token: "abc123" },
      };
      const masked = maskPayload(payload) as Record<string, unknown>;
      expect((masked.user as Record<string, unknown>).email).toBe("[redacted]");
      expect((masked.user as Record<string, unknown>).id).toBe("u1");
      expect(masked.password).toBe("[redacted]");
      expect((masked.nested as Record<string, unknown>).token).toBe("[redacted]");
    });

    it("truncates long strings (default 200 chars)", () => {
      const long = "x".repeat(500);
      const masked = maskPayload({ note: long }) as { note: string };
      expect(masked.note.length).toBeLessThan(long.length);
      expect(masked.note.endsWith("…")).toBe(true);
    });

    it("preserves primitive payloads (non-object)", () => {
      expect(maskPayload(42)).toBe(42);
      expect(maskPayload("ok")).toBe("ok");
      expect(maskPayload(null)).toBe(null);
    });

    it("supports `disableMasking` to opt-in to raw payloads", () => {
      const payload = { password: "hello" };
      const raw = maskPayload(payload, { disableMasking: true });
      expect(raw).toEqual({ password: "hello" });
    });

    it("masks arrays element-wise", () => {
      const payload = [{ password: "a" }, { password: "b" }];
      const masked = maskPayload(payload) as Array<{ password: string }>;
      expect(masked[0]!.password).toBe("[redacted]");
      expect(masked[1]!.password).toBe("[redacted]");
    });

    it("redacts case-insensitively (Email, AUTHORIZATION)", () => {
      const payload = { Email: "x@y", AUTHORIZATION: "Bearer …" };
      const masked = maskPayload(payload) as Record<string, unknown>;
      expect(masked.Email).toBe("[redacted]");
      expect(masked.AUTHORIZATION).toBe("[redacted]");
    });
  });
});
