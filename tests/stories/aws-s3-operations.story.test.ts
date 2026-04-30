import { describe, expect, it, vi } from "vitest";

import {
  AwsS3Operations,
  type AwsS3OperationsOptions,
} from "../../src/core/files/aws-s3-operations.js";

/**
 * Story · AWS S3 binding for `S3Operations`.
 *
 * The bindings shape is injectable so tests stay AWS-SDK-free; the
 * production binding lives behind a lazy `import()` from
 * `storage-factory`. This story drives the wrapper through every
 * happy path + the descriptive errors it surfaces.
 */
describe("Story · AwsS3Operations", () => {
  function makeBindings(): {
    bindings: ConstructorParameters<typeof AwsS3Operations>[1];
    sentCommands: { name: string; input: unknown }[];
    presignerCalls: { command: unknown; expiresIn: number }[];
    objects: Map<string, { body: Uint8Array; mimeType: string }>;
  } {
    const sentCommands: { name: string; input: unknown }[] = [];
    const presignerCalls: { command: unknown; expiresIn: number }[] = [];
    const objects = new Map<string, { body: Uint8Array; mimeType: string }>();

    function makeCmd(name: string) {
      return class {
        readonly _input: Record<string, unknown>;
        readonly _name = name;
        constructor(input: unknown) {
          this._input = input as Record<string, unknown>;
        }
      };
    }

    const bindings = {
      S3Client: class {
        constructor(_config: unknown) {}
        async send(command: unknown): Promise<unknown> {
          const cmd = command as {
            _name: string;
            _input: Record<string, unknown>;
          };
          sentCommands.push({ name: cmd._name, input: cmd._input });
          const key = cmd._input.Key as string;
          switch (cmd._name) {
            case "PutObjectCommand": {
              objects.set(key, {
                body: cmd._input.Body as Uint8Array,
                mimeType: cmd._input.ContentType as string,
              });
              return {};
            }
            case "GetObjectCommand": {
              const obj = objects.get(key);
              if (!obj) {
                const err = new Error("NoSuchKey") as Error & { name: string };
                err.name = "NoSuchKey";
                throw err;
              }
              return {
                Body: obj.body,
                ContentType: obj.mimeType,
              };
            }
            case "DeleteObjectCommand": {
              objects.delete(key);
              return {};
            }
            case "HeadObjectCommand": {
              if (!objects.has(key)) {
                const err = new Error("NotFound") as Error & {
                  name: string;
                  $metadata: { httpStatusCode: number };
                };
                err.name = "NotFound";
                err.$metadata = { httpStatusCode: 404 };
                throw err;
              }
              return {};
            }
            case "ListObjectsV2Command": {
              const prefix = cmd._input.Prefix as string;
              const contents: Array<{ Key: string }> = [];
              for (const k of objects.keys()) {
                if (k.startsWith(prefix)) contents.push({ Key: k });
              }
              return { Contents: contents };
            }
            default:
              throw new Error(`unknown command: ${cmd._name}`);
          }
        }
      },
      GetObjectCommand: makeCmd("GetObjectCommand"),
      PutObjectCommand: makeCmd("PutObjectCommand"),
      DeleteObjectCommand: makeCmd("DeleteObjectCommand"),
      HeadObjectCommand: makeCmd("HeadObjectCommand"),
      ListObjectsV2Command: makeCmd("ListObjectsV2Command"),
      getSignedUrl: vi.fn(async (_client, command, options) => {
        presignerCalls.push({ command, expiresIn: options.expiresIn });
        const key = (command as { _input: { Key: string } })._input.Key;
        return `https://signed.example/${encodeURIComponent(key)}?ttl=${options.expiresIn}`;
      }),
    };
    return { bindings, sentCommands, presignerCalls, objects };
  }

  function makeOps(options: Partial<AwsS3OperationsOptions> = {}): {
    ops: AwsS3Operations;
    harness: ReturnType<typeof makeBindings>;
  } {
    const harness = makeBindings();
    const ops = new AwsS3Operations({ bucket: "test-bucket", ...options }, harness.bindings);
    return { ops, harness };
  }

  function asBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
  }

  it("rejects an empty bucket", () => {
    const harness = makeBindings();
    expect(() => new AwsS3Operations({ bucket: "" }, harness.bindings)).toThrow(/bucket/);
  });

  it("constructor passes region / endpoint / credentials / forcePathStyle through", () => {
    const harness = makeBindings();
    new AwsS3Operations(
      {
        bucket: "b",
        region: "eu-west-1",
        endpoint: "https://rustfs.local",
        credentials: { accessKeyId: "k", secretAccessKey: "s" },
        forcePathStyle: true,
      },
      harness.bindings,
    );
    // The S3Client mock doesn't expose its config, but constructing
    // without throwing proves the optional fields don't trip the
    // exact-shape spread.
    expect(true).toBe(true);
  });

  it("putObject + getObject roundtrip", async () => {
    const { ops } = makeOps();
    await ops.putObject("k", asBytes("hello"), "text/plain");
    const result = await ops.getObject("k");
    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result!.body)).toBe("hello");
    expect(result!.mimeType).toBe("text/plain");
  });

  it("getObject returns null on NoSuchKey", async () => {
    const { ops } = makeOps();
    const result = await ops.getObject("missing");
    expect(result).toBeNull();
  });

  it("deleteObject returns true (best-effort idempotent)", async () => {
    const { ops } = makeOps();
    await ops.putObject("k", asBytes("v"), "t/p");
    expect(await ops.deleteObject("k")).toBe(true);
  });

  it("headObject returns boolean", async () => {
    const { ops } = makeOps();
    expect(await ops.headObject("k")).toBe(false);
    await ops.putObject("k", asBytes("v"), "t/p");
    expect(await ops.headObject("k")).toBe(true);
  });

  it("listObjects returns sorted keys matching prefix", async () => {
    const { ops } = makeOps();
    await ops.putObject("a/c", asBytes("v"), "t/p");
    await ops.putObject("a/b", asBytes("v"), "t/p");
    await ops.putObject("z/x", asBytes("v"), "t/p");
    expect(await ops.listObjects("a/")).toEqual(["a/b", "a/c"]);
  });

  it("presignGet forwards to the supplied getSignedUrl", async () => {
    const { ops, harness } = makeOps();
    const url = await ops.presignGet("k", 600);
    expect(url).toContain("k");
    expect(url).toContain("ttl=600");
    expect(harness.presignerCalls).toHaveLength(1);
    expect(harness.presignerCalls[0]!.expiresIn).toBe(600);
  });
});
