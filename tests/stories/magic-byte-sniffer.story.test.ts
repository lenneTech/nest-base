/**
 * Story · magic-byte MIME sniffer (CF.FILES.07 — iter-118). Pure
 * planner — assertions land on the byte-pattern detection table for
 * the formats the File-Manager pipeline accepts.
 */
import { describe, expect, it } from "vitest";

import {
  checkSniffedMimeMatchesClaim,
  sniffMagicBytes,
} from "../../src/core/files/magic-byte-sniffer.js";

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("Story · magic-byte sniffer", () => {
  describe("sniffMagicBytes", () => {
    it("detects PNG", () => {
      const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0]);
      expect(sniffMagicBytes(png)).toEqual({ mimeType: "image/png", format: "png" });
    });

    it("detects JPEG", () => {
      expect(sniffMagicBytes(bytes([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
        mimeType: "image/jpeg",
        format: "jpeg",
      });
    });

    it("detects GIF87a + GIF89a", () => {
      expect(sniffMagicBytes(bytes([0x47, 0x49, 0x46, 0x38, 0x37, 0x61])).mimeType).toBe(
        "image/gif",
      );
      expect(sniffMagicBytes(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])).mimeType).toBe(
        "image/gif",
      );
    });

    it("detects WebP via the RIFF...WEBP envelope (size bytes are wildcards)", () => {
      const webp = bytes([0x52, 0x49, 0x46, 0x46, 0x12, 0x34, 0x56, 0x78, 0x57, 0x45, 0x42, 0x50]);
      expect(sniffMagicBytes(webp).mimeType).toBe("image/webp");
    });

    it("detects PDF", () => {
      expect(
        sniffMagicBytes(bytes([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])).mimeType,
      ).toBe("application/pdf");
    });

    it("detects ZIP (PK\\x03\\x04)", () => {
      expect(sniffMagicBytes(bytes([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])).mimeType).toBe(
        "application/zip",
      );
    });

    it("detects MP4 ftypisom", () => {
      const mp4 = bytes([
        0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
      ]);
      expect(sniffMagicBytes(mp4).mimeType).toBe("video/mp4");
    });

    it("detects WebM (EBML header)", () => {
      expect(sniffMagicBytes(bytes([0x1a, 0x45, 0xdf, 0xa3])).mimeType).toBe("video/webm");
    });

    it("detects AVIF (ftypavif)", () => {
      const avif = bytes([
        0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, 0, 0, 0, 0,
      ]);
      expect(sniffMagicBytes(avif).mimeType).toBe("image/avif");
    });

    it("detects SVG via leading <svg> tag", () => {
      const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
      expect(sniffMagicBytes(svg).mimeType).toBe("image/svg+xml");
    });

    it("detects SVG prefixed by an XML prolog", () => {
      const svg = new TextEncoder().encode(
        '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      );
      expect(sniffMagicBytes(svg).mimeType).toBe("image/svg+xml");
    });

    it("returns null for empty input + unknown formats", () => {
      expect(sniffMagicBytes(new Uint8Array())).toEqual({ mimeType: null, format: null });
      expect(sniffMagicBytes(bytes([0xde, 0xad, 0xbe, 0xef]))).toEqual({
        mimeType: null,
        format: null,
      });
    });
  });

  describe("checkSniffedMimeMatchesClaim", () => {
    it("returns ok when the claim matches the sniff", () => {
      const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(checkSniffedMimeMatchesClaim(png, "image/png")).toEqual({
        ok: true,
        sniffed: "image/png",
        claimed: "image/png",
      });
    });

    it("ignores parameters on the claimed mime (charset, boundary)", () => {
      const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(checkSniffedMimeMatchesClaim(png, "image/png; charset=binary").ok).toBe(true);
    });

    it("returns ok=true when the sniffer can't identify the body (lenient mode)", () => {
      const unknown = bytes([0xde, 0xad, 0xbe, 0xef]);
      expect(checkSniffedMimeMatchesClaim(unknown, "application/octet-stream")).toEqual({
        ok: true,
        sniffed: null,
        claimed: "application/octet-stream",
      });
    });

    it("returns ok=false when the claim contradicts the sniff", () => {
      const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(checkSniffedMimeMatchesClaim(png, "application/x-msdownload")).toEqual({
        ok: false,
        sniffed: "image/png",
        claimed: "application/x-msdownload",
      });
    });
  });
});
