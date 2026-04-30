/**
 * Storage adapter factory.
 *
 * Boot-time factory that returns the configured `StorageAdapter`
 * based on `features.files.storageDefault` + the `STORAGE_*` env
 * vars. Switching backends requires a restart (the wiring is read
 * once at boot); we don't track capacitive migration between
 * backends.
 *
 * Why this lives in core: the FilesModule provider is constructed
 * synchronously by Nest. The factory is sync for `local` / `postgres`
 * and runs an async dynamic `import()` for `s3` so the AWS SDK stays
 * an optional dependency.
 */

import { resolve } from "node:path";

import { LocalStorageAdapter } from "./local-storage-adapter.js";
import { PostgresStorageAdapter } from "./postgres-storage-adapter.js";
import {
  S3StorageAdapter,
  type S3Operations,
  type S3StorageAdapterOptions,
} from "./s3-storage-adapter.js";
import type { StorageAdapter } from "./storage-adapter.js";

export type StorageDriver = "s3" | "local" | "postgres";

export interface StorageFactoryEnv {
  STORAGE_LOCAL_ROOT?: string;
  STORAGE_BASE_URL?: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  S3_FORCE_PATH_STYLE?: string;
  S3_MAX_TTL_SECONDS?: string;
  APP_BASE_URL?: string;
}

export interface StorageFactoryOptions {
  driver: StorageDriver;
  env: StorageFactoryEnv;
  /**
   * Override the S3 operations binding — tests pass an in-memory mock
   * so they don't need the AWS SDK installed.
   */
  s3OperationsFactory?: (env: StorageFactoryEnv) => Promise<S3Operations>;
  /**
   * Override the Postgres operations factory — production wiring
   * passes an adapter that scopes the `FileBlob` table to a tenant
   * id at boot. Tests pass a fake.
   */
  postgresAdapter?: PostgresStorageAdapter;
}

/**
 * Resolve the configured StorageAdapter at boot. Async to allow the
 * lazy `import('@aws-sdk/client-s3')` for the S3 driver.
 */
export async function createStorageAdapter(
  options: StorageFactoryOptions,
): Promise<StorageAdapter> {
  switch (options.driver) {
    case "local":
      return createLocalAdapter(options.env);
    case "postgres":
      return createPostgresAdapter(options);
    case "s3":
      return createS3Adapter(options);
    default: {
      const exhaustive: never = options.driver;
      throw new Error(`storage-factory: unknown driver "${String(exhaustive)}"`);
    }
  }
}

export function resolveStorageBaseUrl(env: StorageFactoryEnv): string {
  return env.STORAGE_BASE_URL ?? env.APP_BASE_URL ?? "http://localhost:3000/files";
}

function createLocalAdapter(env: StorageFactoryEnv): LocalStorageAdapter {
  const root = env.STORAGE_LOCAL_ROOT ?? "./data/uploads";
  return new LocalStorageAdapter({
    root: resolve(process.cwd(), root),
    baseUrl: resolveStorageBaseUrl(env),
  });
}

function createPostgresAdapter(options: StorageFactoryOptions): PostgresStorageAdapter {
  if (options.postgresAdapter) return options.postgresAdapter;
  throw new Error(
    "storage-factory: driver=postgres requires postgresAdapter to be supplied (request-scoped binding)",
  );
}

async function createS3Adapter(options: StorageFactoryOptions): Promise<S3StorageAdapter> {
  const factory = options.s3OperationsFactory ?? defaultS3OperationsFactory;
  const ops = await factory(options.env);
  const adapterOptions: S3StorageAdapterOptions = {};
  if (options.env.S3_MAX_TTL_SECONDS) {
    adapterOptions.maxTtlSeconds = Number.parseInt(options.env.S3_MAX_TTL_SECONDS, 10);
  }
  return new S3StorageAdapter(ops, adapterOptions);
}

/**
 * Default S3 binding. Lazily imports `@aws-sdk/client-s3` so projects
 * that don't enable the s3 driver never pay for the dependency.
 *
 * The function throws a descriptive error when the SDK is not
 * installed — the message points at the install command.
 */
async function defaultS3OperationsFactory(env: StorageFactoryEnv): Promise<S3Operations> {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error("storage-factory: S3_BUCKET is required for the s3 driver");

  const { AwsS3Operations } = await loadAwsS3Operations();
  return new AwsS3Operations({
    bucket,
    ...(env.S3_REGION ? { region: env.S3_REGION } : {}),
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? { credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } }
      : {}),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true" || env.S3_FORCE_PATH_STYLE === "1",
  });
}

async function loadAwsS3Operations(): Promise<typeof import("./aws-s3-operations.js")> {
  try {
    return await import("./aws-s3-operations.js");
  } catch (err) {
    const original = err instanceof Error ? err.message : String(err);
    throw new Error(
      `storage-factory: failed to load the s3 driver — install the AWS SDK (\`bun add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner\`) and try again. underlying: ${original}`,
    );
  }
}
