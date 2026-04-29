import { describe, expect, it } from "vitest";

import {
  TusUploadConfigSchema,
  tusUploadConfigDefaults,
  resolveTusMountPath,
} from "../../src/core/files/tus-upload-config.js";

/**
 * Story · TUS resumable upload (PLAN.md §8 + §28.2/#6).
 *
 * `@tus/server` v3 powers resumable uploads. This spec pins the
 * config surface — the running endpoint lands when the storage
 * adapter is wired (later slice).
 */
describe("Story · TUS upload config", () => {
  it("accepts a complete config", () => {
    const result = TusUploadConfigSchema.safeParse({
      mountPath: "/api/files/upload",
      maxUploadBytes: 50 * 1024 * 1024,
      allowedMimeTypes: ["image/*", "application/pdf"],
      chunkExpirationSeconds: 60 * 60 * 24,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-positive maxUploadBytes", () => {
    expect(
      TusUploadConfigSchema.safeParse({
        mountPath: "/api/files/upload",
        maxUploadBytes: 0,
        allowedMimeTypes: [],
        chunkExpirationSeconds: 1,
      }).success,
    ).toBe(false);
  });

  it("rejects mountPath without leading slash", () => {
    expect(
      TusUploadConfigSchema.safeParse({
        mountPath: "api/files/upload",
        maxUploadBytes: 1,
        allowedMimeTypes: [],
        chunkExpirationSeconds: 1,
      }).success,
    ).toBe(false);
  });

  describe("tusUploadConfigDefaults()", () => {
    it("default mountPath is /api/files/upload", () => {
      expect(tusUploadConfigDefaults().mountPath).toBe("/api/files/upload");
    });

    it("default maxUploadBytes is at least 50 MB (typical avatar / doc upload)", () => {
      expect(tusUploadConfigDefaults().maxUploadBytes).toBeGreaterThanOrEqual(50 * 1024 * 1024);
    });

    it("default chunkExpirationSeconds is at least 1 hour", () => {
      expect(tusUploadConfigDefaults().chunkExpirationSeconds).toBeGreaterThanOrEqual(60 * 60);
    });
  });

  describe("resolveTusMountPath()", () => {
    it("returns the default when no override is given", () => {
      expect(resolveTusMountPath()).toBe("/api/files/upload");
    });

    it("honors a custom path", () => {
      expect(resolveTusMountPath("/uploads")).toBe("/uploads");
    });

    it("rejects mount paths without leading slash", () => {
      expect(() => resolveTusMountPath("uploads")).toThrow();
    });
  });
});
