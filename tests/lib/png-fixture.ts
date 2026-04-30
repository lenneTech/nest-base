/**
 * Inline PNG fixture for asset / IPX tests.
 *
 * 8×8 emerald RGB → PNG, base64-encoded. Pinned bytes so tests stay
 * deterministic and don't depend on a direct `import sharp from "sharp"`
 * (rule from issue #17: no direct sharp imports outside node_modules).
 *
 * Generated once with:
 *   sharp({ create: { width: 8, height: 8, channels: 3, background: '#10b981' } }).png()
 */
const PNG_8X8_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQ2NmIFTEMLQkAIGhSgfYObeYAAAAASUVORK5CYII=";

/**
 * Returns a fresh `Uint8Array` of the canonical 8×8 PNG fixture.
 *
 * Each call returns its own buffer — caller may mutate freely.
 */
export function emerald8x8Png(): Uint8Array {
  return new Uint8Array(Buffer.from(PNG_8X8_BASE64, "base64"));
}
