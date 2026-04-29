import { describe, expect, it } from "vitest";

import {
  isMimeTypeAllowed,
  validateUploadFileType,
  FileTypeRejectedError,
} from "../../src/core/files/tus-file-type-validation.js";

/**
 * Adapted from nest-server `tus-file-type-validation.spec.ts`.
 *
 * Mime-type allowlist enforcement for TUS uploads. An empty allowlist
 * means "no restriction" by design — projects opt in by listing types.
 * Wildcards (`image/*`) match the type prefix; the `*\/*` wildcard
 * matches anything.
 */
describe("TUS · file-type validation", () => {
  describe("isMimeTypeAllowed()", () => {
    it("exact match", () => {
      expect(isMimeTypeAllowed("image/png", ["image/png"])).toBe(true);
      expect(isMimeTypeAllowed("application/pdf", ["image/png"])).toBe(false);
    });

    it("group wildcard `image/*` matches `image/png`, `image/jpeg`, …", () => {
      expect(isMimeTypeAllowed("image/png", ["image/*"])).toBe(true);
      expect(isMimeTypeAllowed("image/jpeg", ["image/*"])).toBe(true);
      expect(isMimeTypeAllowed("application/pdf", ["image/*"])).toBe(false);
    });

    it("full wildcard `*/*` matches anything", () => {
      expect(isMimeTypeAllowed("image/png", ["*/*"])).toBe(true);
      expect(isMimeTypeAllowed("application/octet-stream", ["*/*"])).toBe(true);
    });

    it("empty allowlist permits anything (opt-in policy)", () => {
      expect(isMimeTypeAllowed("image/png", [])).toBe(true);
    });

    it("case-insensitive on the type and subtype", () => {
      expect(isMimeTypeAllowed("IMAGE/PNG", ["image/png"])).toBe(true);
      expect(isMimeTypeAllowed("image/png", ["IMAGE/PNG"])).toBe(true);
    });

    it("rejects empty input mime type defensively", () => {
      expect(isMimeTypeAllowed("", ["image/*"])).toBe(false);
    });

    it("rejects malformed mime types (no slash)", () => {
      expect(isMimeTypeAllowed("image-png", ["image/*"])).toBe(false);
    });
  });

  describe("validateUploadFileType()", () => {
    it("returns the input mime when allowed", () => {
      expect(validateUploadFileType("image/png", ["image/*"])).toBe("image/png");
    });

    it("throws FileTypeRejectedError when not allowed", () => {
      expect(() => validateUploadFileType("application/x-evil", ["image/*"])).toThrow(
        FileTypeRejectedError,
      );
    });

    it("FileTypeRejectedError carries the rejected mime in its message", () => {
      try {
        validateUploadFileType("application/x-evil", ["image/*"]);
        expect.fail("expected throw");
      } catch (err) {
        expect((err as Error).message).toContain("application/x-evil");
      }
    });
  });
});
