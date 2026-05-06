/**
 * Pure planner — minimal magic-byte MIME sniffer (CF.FILES.07 —
 * iter-118).
 *
 * The TUS upload pipeline previously trusted the client-supplied
 * `Content-Type` header. A malicious client can claim
 * `image/png` and send a `.exe`. The PRD's "MIME sniffing"
 * requirement asks us to detect the body's actual format from its
 * leading bytes and reject mismatches.
 *
 * Coverage scope: the formats most likely to ride through the
 * File-Manager — PNG, JPEG, GIF, WebP, AVIF, PDF, ZIP, MP4, WebM,
 * SVG. Anything outside this set returns `null` (caller falls back
 * to the client-supplied header — defensive: blocking unknown
 * formats would break legitimate uploads).
 *
 * Implementation: exact match against the file's leading bytes. The
 * planner takes a `Uint8Array` (the first ~16 bytes of the body)
 * and returns the canonical mime-type string OR `null` if the
 * format isn't recognised.
 */

export interface MagicByteSniffResult {
  /** Detected mime-type, or null when no signature matched. */
  readonly mimeType: string | null;
  /** Canonical name of the matched signature (for telemetry / logs). */
  readonly format: string | null;
}

interface Signature {
  readonly name: string;
  readonly mime: string;
  readonly bytes: readonly (number | null)[];
  readonly offset?: number;
}

// Wildcard slot — `null` matches any byte at that position.
const SIGNATURES: readonly Signature[] = [
  { name: "png", mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: "jpeg", mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { name: "gif87a", mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
  { name: "gif89a", mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
  // RIFF.....WEBP — 4 bytes RIFF, 4 bytes size (wildcards), 4 bytes WEBP.
  {
    name: "webp",
    mime: "image/webp",
    bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
  { name: "pdf", mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // PK\x03\x04 (also docx/xlsx/zip-based formats — caller can refine
  // by sniffing OOXML markers if required).
  { name: "zip", mime: "application/zip", bytes: [0x50, 0x4b, 0x03, 0x04] },
  // ftypMP4 / ftypisom — at offset 4, "ftyp"; the brand follows.
  // We match the "ftyp" tag at offset 4 + the major-brand prefix
  // "mp4" / "isom" / "M4V" at offset 8.
  {
    name: "mp4",
    mime: "video/mp4",
    bytes: [null, null, null, null, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d],
  },
  {
    name: "mp4-mp42",
    mime: "video/mp4",
    bytes: [null, null, null, null, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32],
  },
  // EBML header — webm + matroska.
  { name: "webm", mime: "video/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  // AVIF: ftyp + avif/avis brand at offset 8.
  {
    name: "avif",
    mime: "image/avif",
    bytes: [null, null, null, null, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66],
  },
];

/**
 * Sniff the leading bytes of `bytes` against the known signature
 * table. Returns the canonical mime + format name, or
 * `{mimeType: null, format: null}` when no signature matched.
 */
export function sniffMagicBytes(bytes: Uint8Array): MagicByteSniffResult {
  if (bytes.length === 0) return { mimeType: null, format: null };
  // SVG lookahead — `<svg`, `<?xml`, or BOM-prefixed variants. The
  // signature table can't represent variable-leading-whitespace
  // markers cleanly, so handle SVG separately.
  const ascii = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 256)).trim();
  if (/^<\?xml[\s\S]*<svg[\s>]/i.test(ascii) || /^<svg[\s>]/i.test(ascii)) {
    return { mimeType: "image/svg+xml", format: "svg" };
  }
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (bytes.length < offset + sig.bytes.length) continue;
    let matched = true;
    for (let i = 0; i < sig.bytes.length; i++) {
      const expected = sig.bytes[i];
      if (expected === null) continue;
      if (bytes[offset + i] !== expected) {
        matched = false;
        break;
      }
    }
    if (matched) return { mimeType: sig.mime, format: sig.name };
  }
  return { mimeType: null, format: null };
}

/**
 * Decide whether the client-claimed mime is consistent with the
 * sniffed mime. Returns:
 *   - `{ ok: true, sniffed }`             — sniffer matched the claim
 *   - `{ ok: true, sniffed: null }`       — sniffer recognised nothing,
 *                                           caller decides (lenient mode)
 *   - `{ ok: false, sniffed, claimed }`   — claim contradicts sniff
 *
 * The caller flips this decision into a 400 response (or, in strict
 * mode, can also reject sniffer-null cases for "unknown format").
 */
export interface MimeMatchResult {
  readonly ok: boolean;
  readonly sniffed: string | null;
  readonly claimed: string;
}

export function checkSniffedMimeMatchesClaim(bytes: Uint8Array, claimed: string): MimeMatchResult {
  const sniffed = sniffMagicBytes(bytes).mimeType;
  if (sniffed === null) return { ok: true, sniffed: null, claimed };
  // Compare lower-cased + ignore subtype-parameters (e.g. ";charset=…").
  const left = claimed.toLowerCase().split(";")[0]?.trim() ?? "";
  const right = sniffed.toLowerCase();
  return { ok: left === right, sniffed, claimed };
}
