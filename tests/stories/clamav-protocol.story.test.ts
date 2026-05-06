/**
 * Story · ClamAV INSTREAM protocol planner (CF.FILES.06 — iter-120).
 *
 * Pure helpers — frame builder + reply parser. The runner does the
 * net I/O; this story locks the wire format so a future refactor
 * can't silently drop the 4-byte length headers or mis-parse a
 * `FOUND` verdict.
 */
import { describe, expect, it } from "vitest";

import {
  buildClamavInstreamFrames,
  parseClamavReply,
} from "../../src/core/files/clamav-protocol.js";

describe("Story · clamav-protocol", () => {
  describe("buildClamavInstreamFrames", () => {
    it("opens with the literal `zINSTREAM\\0` command", () => {
      const frames = buildClamavInstreamFrames(new Uint8Array([1, 2, 3]));
      expect(frames.command.toString("utf8")).toBe("zINSTREAM\0");
    });

    it("encodes a single chunk as 4-byte BE length + bytes", () => {
      const body = new Uint8Array([0xaa, 0xbb, 0xcc]);
      const frames = buildClamavInstreamFrames(body);
      expect(frames.chunks).toHaveLength(1);
      const chunk = frames.chunks[0]!;
      expect(chunk.readUInt32BE(0)).toBe(3);
      expect(chunk.subarray(4).equals(Buffer.from(body))).toBe(true);
    });

    it("splits bodies > 64 KiB into multiple frames", () => {
      const big = new Uint8Array(70_000);
      const frames = buildClamavInstreamFrames(big);
      expect(frames.chunks.length).toBeGreaterThan(1);
      // Sum of chunk-payload lengths equals the body length.
      const total = frames.chunks.reduce((sum, c) => sum + c.readUInt32BE(0), 0);
      expect(total).toBe(big.length);
    });

    it("emits a 4-byte zero terminator", () => {
      const frames = buildClamavInstreamFrames(new Uint8Array([1]));
      expect(frames.terminator.length).toBe(4);
      expect(frames.terminator.readUInt32BE(0)).toBe(0);
    });

    it("emits no chunks for an empty body — terminator alone signals end", () => {
      const frames = buildClamavInstreamFrames(new Uint8Array());
      expect(frames.chunks).toHaveLength(0);
      expect(frames.terminator.readUInt32BE(0)).toBe(0);
    });
  });

  describe("parseClamavReply", () => {
    it("returns clean for `stream: OK`", () => {
      expect(parseClamavReply("stream: OK\0").verdict).toBe("clean");
    });

    it("returns infected with the threat name for `stream: <name> FOUND`", () => {
      const result = parseClamavReply("stream: Eicar-Test-Signature FOUND\0");
      expect(result.verdict).toBe("infected");
      expect(result.threatName).toBe("Eicar-Test-Signature");
    });

    it("handles multi-word signature names", () => {
      const result = parseClamavReply("stream: Win.Trojan.Foo-1234 FOUND\0");
      expect(result.verdict).toBe("infected");
      expect(result.threatName).toBe("Win.Trojan.Foo-1234");
    });

    it("returns indeterminate on ERROR replies", () => {
      expect(parseClamavReply("stream: out-of-memory ERROR\0").verdict).toBe("indeterminate");
    });

    it("returns indeterminate on empty / unparseable replies", () => {
      expect(parseClamavReply("").verdict).toBe("indeterminate");
      expect(parseClamavReply("garbled binary").verdict).toBe("indeterminate");
    });

    it("strips the optional `stream:` prefix on bare `OK` replies", () => {
      expect(parseClamavReply("OK\0").verdict).toBe("clean");
    });
  });
});
