import { describe, expect, it } from "vitest";

import { resolveStoragePath, sanitiseFilename } from "../../src/core/files/storage-path.js";

/**
 * Story · Storage path resolution.
 *
 * Pure planner. Maps `(tenantId, folderId, fileId, filename)` to the
 * deterministic key the StorageAdapter writes to.
 *
 * Layout: `<tenantId>/<folder|root>/<fileId>-<sanitised-filename>`.
 */
describe("Story · Storage path planner", () => {
  it("composes tenantId/folder/fileId-filename for a folder upload", () => {
    expect(
      resolveStoragePath({
        tenantId: "t1",
        folderId: "f1",
        fileId: "id1",
        filename: "photo.jpg",
      }),
    ).toBe("t1/f1/id1-photo.jpg");
  });

  it("uses `_root` segment when folderId is null", () => {
    expect(
      resolveStoragePath({
        tenantId: "t1",
        folderId: null,
        fileId: "id1",
        filename: "doc.pdf",
      }),
    ).toBe("t1/_root/id1-doc.pdf");
  });

  it("rejects empty tenantId / fileId / filename", () => {
    expect(() =>
      resolveStoragePath({ tenantId: "", folderId: null, fileId: "i", filename: "f" }),
    ).toThrow(/tenantId/i);
    expect(() =>
      resolveStoragePath({ tenantId: "t", folderId: null, fileId: "", filename: "f" }),
    ).toThrow(/fileId/i);
    expect(() =>
      resolveStoragePath({ tenantId: "t", folderId: null, fileId: "i", filename: "" }),
    ).toThrow(/filename/i);
  });

  describe("sanitiseFilename()", () => {
    it("strips path separators and traversal segments", () => {
      expect(sanitiseFilename("../foo.png")).toBe("foo.png");
      expect(sanitiseFilename("a/b/c.png")).toBe("a-b-c.png");
      expect(sanitiseFilename("..\\evil.exe")).toBe("evil.exe");
    });

    it("collapses whitespace and unsafe chars to dashes", () => {
      expect(sanitiseFilename("hello world.txt")).toBe("hello-world.txt");
      expect(sanitiseFilename("file*name?.png")).toBe("file-name-.png");
    });

    it("rejects an empty result after sanitisation", () => {
      expect(() => sanitiseFilename("///")).toThrow(/filename/i);
      expect(() => sanitiseFilename("")).toThrow(/filename/i);
    });

    it("preserves unicode letters + digits + dot + dash + underscore", () => {
      expect(sanitiseFilename("anwendungs-Übersicht_2024.pdf")).toBe(
        "anwendungs-Übersicht_2024.pdf",
      );
    });
  });
});
