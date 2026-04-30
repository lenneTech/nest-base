import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalStorageAdapter } from "../../src/core/files/local-storage-adapter.js";
import { PostgresStorageAdapter } from "../../src/core/files/postgres-storage-adapter.js";
import { S3StorageAdapter, type S3Operations } from "../../src/core/files/s3-storage-adapter.js";
import {
  createStorageAdapter,
  resolveStorageBaseUrl,
} from "../../src/core/files/storage-factory.js";

/**
 * Story · Storage adapter factory.
 *
 * Boot-time helper that picks the right adapter based on
 * `features.files.storageDefault` + env. Two interesting branches
 * (s3 / local / postgres) plus the optional-dep loading of the AWS
 * SDK — covered via an injected operations factory so the tests stay
 * dependency-free.
 */
describe("Story · Storage factory", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "nst-storage-factory-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("driver=local builds a LocalStorageAdapter rooted at STORAGE_LOCAL_ROOT", async () => {
    const adapter = await createStorageAdapter({
      driver: "local",
      env: { STORAGE_LOCAL_ROOT: root, APP_BASE_URL: "http://localhost:3000/files" },
    });
    expect(adapter).toBeInstanceOf(LocalStorageAdapter);
    await adapter.put({ key: "k", body: new Uint8Array([1, 2]), mimeType: "t/p" });
    expect(await adapter.exists("k")).toBe(true);
  });

  it("driver=s3 builds an S3StorageAdapter using the supplied operations factory", async () => {
    const ops: S3Operations = {
      async putObject() {},
      async getObject() {
        return null;
      },
      async deleteObject() {
        return true;
      },
      async headObject() {
        return false;
      },
      async listObjects() {
        return [];
      },
      async presignGet() {
        return "https://example/key";
      },
    };
    const adapter = await createStorageAdapter({
      driver: "s3",
      env: { S3_BUCKET: "test", S3_REGION: "us-east-1", S3_MAX_TTL_SECONDS: "1800" },
      s3OperationsFactory: async () => ops,
    });
    expect(adapter).toBeInstanceOf(S3StorageAdapter);
  });

  it("driver=postgres reuses the supplied adapter (request-scoped binding)", async () => {
    const stub: PostgresStorageAdapter = {
      async put() {
        return { key: "k", sizeBytes: 0, mimeType: "t/p" };
      },
      async get() {
        return new Uint8Array(0);
      },
      async delete() {
        return true;
      },
      async exists() {
        return false;
      },
      async signUrl() {
        return "x";
      },
      async list() {
        return [];
      },
    } as unknown as PostgresStorageAdapter;
    const adapter = await createStorageAdapter({
      driver: "postgres",
      env: {},
      postgresAdapter: stub,
    });
    expect(adapter).toBe(stub);
  });

  it("driver=postgres without a supplied adapter throws a descriptive error", async () => {
    await expect(createStorageAdapter({ driver: "postgres", env: {} })).rejects.toThrow(
      /postgresAdapter/,
    );
  });

  it("resolveStorageBaseUrl prefers STORAGE_BASE_URL, falls back to APP_BASE_URL, then localhost", () => {
    expect(resolveStorageBaseUrl({ STORAGE_BASE_URL: "https://cdn" })).toBe("https://cdn");
    expect(resolveStorageBaseUrl({ APP_BASE_URL: "https://api" })).toBe("https://api");
    expect(resolveStorageBaseUrl({})).toBe("http://localhost:3000/files");
  });

  it("driver=s3 without S3_BUCKET fails fast", async () => {
    await expect(
      createStorageAdapter({
        driver: "s3",
        env: {},
      }),
    ).rejects.toThrow(/S3_BUCKET/);
  });

  it("driver=s3 surfaces a descriptive error when the AWS SDK fails to load", async () => {
    // Default factory is used — the SDK isn't installed in this
    // workspace, so loading raises a wrapped error pointing at the
    // install command.
    await expect(
      createStorageAdapter({
        driver: "s3",
        env: { S3_BUCKET: "test" },
      }),
    ).rejects.toThrow(/aws-sdk|s3 driver/);
  });

  it("rejects an unknown driver", async () => {
    await expect(
      createStorageAdapter({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        driver: "ftp" as any,
        env: {},
      }),
    ).rejects.toThrow(/unknown driver/);
  });
});
