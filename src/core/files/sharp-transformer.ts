/**
 * Sharp-backed `AssetTransformer`.
 *
 * Production binding for `AssetService.transformer`. Wraps the `sharp`
 * native binding behind the same interface the in-memory test
 * transformer implements.
 *
 * Sharp is heavy (10+ MB native binding) — the wrapper pays for it
 * lazily so the storage adapters / pure planners stay test-friendly.
 *
 * Issue #17 swaps this for IPX; this slice keeps the surface so the
 * controller wires up against a real transformer today.
 */

import sharp from "sharp";

import type { AssetTransformer, TransformOptions } from "./asset.service.js";

export class SharpTransformer implements AssetTransformer {
  async transform(
    bytes: Uint8Array,
    options: TransformOptions,
  ): Promise<{ bytes: Uint8Array; mimeType: string }> {
    let pipeline = sharp(Buffer.from(bytes));
    if (options.width !== undefined || options.height !== undefined) {
      pipeline = pipeline.resize({
        ...(options.width !== undefined ? { width: options.width } : {}),
        ...(options.height !== undefined ? { height: options.height } : {}),
        ...(options.fit ? { fit: options.fit } : {}),
      });
    }

    const format = options.format ?? "png";
    const formatOptions: Record<string, unknown> = {};
    if (options.quality !== undefined) formatOptions.quality = options.quality;

    const buffer = await pipeline.toFormat(format, formatOptions).toBuffer();
    return {
      bytes: new Uint8Array(buffer),
      mimeType: `image/${format === "jpeg" ? "jpeg" : format}`,
    };
  }
}
