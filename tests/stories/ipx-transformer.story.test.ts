import { describe, expect, it } from "vitest";

import { IpxAssetTransformer } from "../../src/core/files/ipx-transformer.js";
import { emerald8x8Png, noisy64x64Png } from "../lib/png-fixture.js";

/**
 * Story · IPX-backed AssetTransformer.
 *
 * Replaces the direct-Sharp transformer with an IPX-routed pipeline.
 * Same `AssetTransformer` interface (bytes + options → bytes + mimeType),
 * but the work happens through `createIPX({ storage })` so the
 * implementation matches the URL-routed pipeline used by the
 * `/_ipx/*` endpoint.
 */

const sourcePng = emerald8x8Png;

describe("Story · IpxAssetTransformer", () => {
  it("emits webp bytes with image/webp mime when format=webp", async () => {
    const transformer = new IpxAssetTransformer();
    const result = await transformer.transform(sourcePng(), {
      width: 4,
      format: "webp",
    });
    expect(result.mimeType).toBe("image/webp");
    // The webp magic header is `RIFF…WEBP`.
    const head = new TextDecoder("ascii").decode(result.bytes.slice(0, 4));
    expect(head).toBe("RIFF");
  });

  it("emits png bytes with image/png mime when no format requested", async () => {
    const transformer = new IpxAssetTransformer();
    const result = await transformer.transform(sourcePng(), { width: 4 });
    expect(result.mimeType).toBe("image/png");
    // PNG magic header: 89 50 4E 47 0D 0A 1A 0A.
    const head = result.bytes.slice(0, 8);
    expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("respects the quality option for jpeg (lower quality → smaller bytes)", async () => {
    const transformer = new IpxAssetTransformer();
    // Use a noisy 64x64 fixture — JPEG quality differences only show
    // up clearly once there are enough pixels to compress.
    const source = noisy64x64Png();
    const high = await transformer.transform(source, {
      format: "jpeg",
      quality: 90,
    });
    const low = await transformer.transform(source, {
      format: "jpeg",
      quality: 10,
    });
    expect(high.mimeType).toBe("image/jpeg");
    expect(low.bytes.byteLength).toBeLessThanOrEqual(high.bytes.byteLength);
  });

  it("supports avif format", async () => {
    const transformer = new IpxAssetTransformer();
    const result = await transformer.transform(sourcePng(), {
      width: 4,
      format: "avif",
    });
    expect(result.mimeType).toBe("image/avif");
  });
});
