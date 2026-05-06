/**
 * AWS S3 binding for `S3Operations`.
 *
 * Wraps `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. The
 * SDK is an optional peer dependency — projects that pick a non-S3
 * `storageDefault` never need to install it.
 *
 * This module is loaded via dynamic `import()` from
 * `storage-factory.ts`. A descriptive error message points at the
 * install command when the SDK is missing.
 *
 * Loading is split into a thin static class that requires the SDK
 * already-resolved (so tests can fake it) and a `create()` factory
 * that pulls the SDK at first use.
 */

import type { S3GetResult, S3Operations } from "./s3-storage-adapter.js";

export interface AwsS3OperationsOptions {
  bucket: string;
  region?: string;
  endpoint?: string;
  credentials?: { accessKeyId: string; secretAccessKey: string };
  forcePathStyle?: boolean;
}

interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

interface AwsSdkBindings {
  S3Client: new (config: unknown) => S3ClientLike;
  GetObjectCommand: new (input: unknown) => unknown;
  PutObjectCommand: new (input: unknown) => unknown;
  DeleteObjectCommand: new (input: unknown) => unknown;
  HeadObjectCommand: new (input: unknown) => unknown;
  ListObjectsV2Command: new (input: unknown) => unknown;
  getSignedUrl(
    client: S3ClientLike,
    command: unknown,
    options: { expiresIn: number },
  ): Promise<string>;
}

let cachedBindings: AwsSdkBindings | null = null;

export class AwsS3Operations implements S3Operations {
  private readonly client: S3ClientLike;
  private readonly bucket: string;
  private readonly bindings: AwsSdkBindings;

  constructor(options: AwsS3OperationsOptions, bindings?: AwsSdkBindings) {
    if (!options.bucket) throw new Error("aws-s3-operations: bucket is required");
    if (!bindings) {
      if (!cachedBindings) {
        throw new Error(
          "aws-s3-operations: bindings not loaded — call AwsS3Operations.preload() first or pass bindings directly",
        );
      }
      bindings = cachedBindings;
    }
    this.bindings = bindings;
    this.bucket = options.bucket;
    this.client = new bindings.S3Client({
      ...(options.region ? { region: options.region } : {}),
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.forcePathStyle !== undefined ? { forcePathStyle: options.forcePathStyle } : {}),
    });
  }

  /**
   * Eagerly load the AWS SDK. Called by `storage-factory` before the
   * first instance is constructed so the cost is paid once.
   */
  static async preload(): Promise<void> {
    if (cachedBindings) return;
    const sdk = await loadSdk();
    cachedBindings = sdk;
  }

  async putObject(key: string, body: Uint8Array, mimeType: string): Promise<void> {
    const cmd = new this.bindings.PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
    });
    await this.client.send(cmd);
  }

  async getObject(key: string): Promise<S3GetResult | null> {
    try {
      const cmd = new this.bindings.GetObjectCommand({ Bucket: this.bucket, Key: key });
      const response = (await this.client.send(cmd)) as {
        Body?: unknown;
        ContentType?: string;
      };
      if (!response.Body) return null;
      const body = await streamToUint8Array(response.Body);
      return { body, mimeType: response.ContentType ?? "application/octet-stream" };
    } catch (err) {
      if (isS3NotFound(err)) return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<boolean> {
    try {
      const cmd = new this.bindings.DeleteObjectCommand({ Bucket: this.bucket, Key: key });
      await this.client.send(cmd);
      return true;
    } catch (err) {
      if (isS3NotFound(err)) return false;
      throw err;
    }
  }

  async headObject(key: string): Promise<boolean> {
    try {
      const cmd = new this.bindings.HeadObjectCommand({ Bucket: this.bucket, Key: key });
      await this.client.send(cmd);
      return true;
    } catch (err) {
      if (isS3NotFound(err)) return false;
      throw err;
    }
  }

  async listObjects(prefix: string): Promise<string[]> {
    const cmd = new this.bindings.ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });
    const response = (await this.client.send(cmd)) as {
      Contents?: Array<{ Key?: string }>;
    };
    if (!response.Contents) return [];
    return response.Contents.map((entry) => entry.Key)
      .filter((k): k is string => typeof k === "string")
      .sort();
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    const cmd = new this.bindings.GetObjectCommand({ Bucket: this.bucket, Key: key });
    return this.bindings.getSignedUrl(this.client, cmd, { expiresIn: ttlSeconds });
  }
}

/**
 * Type-erasing helper for optional-peer-dependency dynamic imports.
 * `import("@aws-sdk/client-s3")` would fail TypeScript's static
 * module-resolution check because the package isn't a hard dep —
 * routing the specifier through this helper materialises the module
 * at runtime without coupling the static type-check to the
 * presence of the peer dep.
 */
async function optionalImport(specifier: string): Promise<Record<string, unknown>> {
  const dynamicImport: (s: string) => Promise<unknown> = Function(
    "specifier",
    "return import(specifier)",
  ) as (s: string) => Promise<unknown>;
  const mod = await dynamicImport(specifier);
  if (typeof mod !== "object" || mod === null) {
    throw new Error(`optionalImport(${specifier}): expected a module object, got ${typeof mod}`);
  }
  return mod as Record<string, unknown>;
}

async function loadSdk(): Promise<AwsSdkBindings> {
  // Two dynamic imports so a missing peer dep produces a clear
  // message. The module specifiers ride through `optionalImport()`
  // so the static type-check doesn't fail on a missing peer.
  const [client, presigner] = await Promise.all([
    optionalImport("@aws-sdk/client-s3").catch((err) => {
      throw new Error(
        `aws-s3-operations: failed to load @aws-sdk/client-s3 — run \`bun add @aws-sdk/client-s3\`. underlying: ${err}`,
      );
    }),
    optionalImport("@aws-sdk/s3-request-presigner").catch((err) => {
      throw new Error(
        `aws-s3-operations: failed to load @aws-sdk/s3-request-presigner — run \`bun add @aws-sdk/s3-request-presigner\`. underlying: ${err}`,
      );
    }),
  ]);
  // The optional-import helper materialises modules typed as
  // `Record<string, unknown>`; the runtime guarantees these
  // properties exist (we just imported the SDK), so cast each export
  // to its narrowed binding type.
  return {
    S3Client: client.S3Client as AwsSdkBindings["S3Client"],
    GetObjectCommand: client.GetObjectCommand as AwsSdkBindings["GetObjectCommand"],
    PutObjectCommand: client.PutObjectCommand as AwsSdkBindings["PutObjectCommand"],
    DeleteObjectCommand: client.DeleteObjectCommand as AwsSdkBindings["DeleteObjectCommand"],
    HeadObjectCommand: client.HeadObjectCommand as AwsSdkBindings["HeadObjectCommand"],
    ListObjectsV2Command: client.ListObjectsV2Command as AwsSdkBindings["ListObjectsV2Command"],
    getSignedUrl: presigner.getSignedUrl as AwsSdkBindings["getSignedUrl"],
  };
}

function isS3NotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === "NoSuchKey" ||
    e.name === "NotFound" ||
    e.Code === "NoSuchKey" ||
    e.$metadata?.httpStatusCode === 404
  );
}

async function streamToUint8Array(body: unknown): Promise<Uint8Array> {
  // The AWS SDK returns either a Web ReadableStream (browser) or a
  // Node.js Readable. We support both — and a Uint8Array passthrough
  // for tests that pre-resolve the body.
  if (body instanceof Uint8Array) return body;
  if (
    typeof (body as { transformToByteArray?: () => Promise<Uint8Array> }).transformToByteArray ===
    "function"
  ) {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }
  // Fallback: collect chunks from an async-iterable.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer>) {
    const slice = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
    chunks.push(slice);
    total += slice.byteLength;
  }
  const merged = new Uint8Array(total);
  let cursor = 0;
  for (const c of chunks) {
    merged.set(c, cursor);
    cursor += c.byteLength;
  }
  return merged;
}
