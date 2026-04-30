import { createIPX, type IPX, type IPXStorage } from "ipx";

import type { AssetTransformer, TransformOptions } from "./asset.service.js";

/**
 * IPX-backed `AssetTransformer`.
 *
 * Production binding for `AssetService.transformer` after issue #17.
 * Replaces the direct-`sharp` import — IPX wraps Sharp internally and
 * we route through the same modifier pipeline the `/_ipx/*` URL
 * surface uses, so inline transforms (Service-layer code) and URL
 * transforms (Controller layer) cannot drift.
 *
 * The transformer hosts a tiny in-memory IPX storage that serves the
 * caller's bytes under a synthetic key per call. IPX is stateless
 * past `createIPX()`, so we bind the storage at call time.
 */
export class IpxAssetTransformer implements AssetTransformer {
  async transform(
    bytes: Uint8Array,
    options: TransformOptions,
  ): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const id = "asset.bin";
    const storage = inMemorySource(id, bytes);
    const ipx: IPX = createIPX({ storage });

    const modifiers: Partial<Record<string, string>> = {};
    if (options.width !== undefined) modifiers.w = String(options.width);
    if (options.height !== undefined) modifiers.h = String(options.height);
    if (options.format !== undefined) modifiers.f = options.format;
    if (options.quality !== undefined) modifiers.q = String(options.quality);
    if (options.fit !== undefined) modifiers.fit = options.fit;

    // Default to png when no explicit format is requested. IPX's
    // default is jpeg which would silently change the content-type
    // for callers that omit `format`; preserving the previous
    // SharpTransformer contract keeps the AssetTransformer interface
    // backwards compatible.
    const format = options.format ?? "png";
    if (modifiers.f === undefined) modifiers.f = format;

    const img = ipx(id, modifiers);
    const result = await img.process();
    const data = result.data;
    const buffer = typeof data === "string" ? Buffer.from(data, "utf-8") : data;

    return {
      bytes: new Uint8Array(buffer),
      mimeType: `image/${format === "jpeg" ? "jpeg" : format}`,
    };
  }
}

function inMemorySource(id: string, bytes: Uint8Array): IPXStorage {
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return {
    name: "inline",
    getMeta(requested) {
      if (requested !== id && requested !== `/${id}`) return undefined;
      return { maxAge: 0 };
    },
    getData(requested) {
      if (requested !== id && requested !== `/${id}`) return undefined;
      return ab;
    },
  };
}
