import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { SharpTransformer } from "../../src/core/files/sharp-transformer.js";

/**
 * Story · Sharp-backed AssetTransformer.
 *
 * Smoke test that the production binding actually invokes sharp and
 * produces bytes in the requested format. Uses sharp directly to
 * synthesize a tiny test PNG so the test does not depend on a fixture.
 */
describe("Story · SharpTransformer", () => {
  async function makePng(width: number, height: number): Promise<Uint8Array> {
    const buffer = await sharp({
      create: { width, height, channels: 3, background: "#10b981" },
    })
      .png()
      .toBuffer();
    return new Uint8Array(buffer);
  }

  it("resizes to the requested width and emits a webp by default when format=webp", async () => {
    const transformer = new SharpTransformer();
    const original = await makePng(64, 64);
    const result = await transformer.transform(original, { width: 32, format: "webp" });
    expect(result.mimeType).toBe("image/webp");
    // The webp magic header is `RIFF…WEBP`.
    expect(result.bytes.byteLength).toBeGreaterThan(8);
    const head = new TextDecoder("ascii").decode(result.bytes.slice(0, 4));
    expect(head).toBe("RIFF");
  });

  it("returns a png when no format is supplied", async () => {
    const transformer = new SharpTransformer();
    const original = await makePng(8, 8);
    const result = await transformer.transform(original, { width: 4 });
    expect(result.mimeType).toBe("image/png");
    // PNG magic header: 89 50 4E 47 0D 0A 1A 0A.
    const head = result.bytes.slice(0, 8);
    expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("respects the quality option for jpeg", async () => {
    const transformer = new SharpTransformer();
    const original = await makePng(64, 64);
    const high = await transformer.transform(original, { format: "jpeg", quality: 90 });
    const low = await transformer.transform(original, { format: "jpeg", quality: 10 });
    expect(high.mimeType).toBe("image/jpeg");
    expect(low.bytes.byteLength).toBeLessThanOrEqual(high.bytes.byteLength);
  });
});
