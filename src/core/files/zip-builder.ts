/**
 * Pure planner — builds a minimal STORED-mode (no-compression) ZIP
 * archive from a list of `{filename, bytes}` entries. STORED mode is
 * trivial to emit + universally supported and avoids pulling a
 * compression dependency for the bulk-download surface (CF.FILES.06,
 * iter-114).
 *
 * Implemented to PKZIP spec sections 4.3.7 (Local File Header),
 * 4.3.12 (Central Directory File Header) and 4.3.16 (End of Central
 * Directory Record). Empty archives are valid and emit only the EOCD
 * record.
 *
 * Filenames ride as UTF-8 (general-purpose-bit-flag 0x0800).
 */

export interface ZipEntryInput {
  /** Filename inside the archive. Slashes are accepted as path separators. */
  readonly filename: string;
  readonly bytes: Uint8Array;
}

interface ZipEntryPlan {
  readonly filename: string;
  readonly filenameBytes: Uint8Array;
  readonly bytes: Uint8Array;
  readonly crc32: number;
  readonly localHeaderOffset: number;
}

const SIG_LFH = 0x04034b50;
const SIG_CDH = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const ZIP_VERSION = 20;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;

function dosTime(): number {
  // Fixed 1980-01-01 00:00:00 — keeps the planner deterministic so
  // identical inputs round-trip to byte-identical archives. Real time
  // would belong on the runner, not the planner.
  return 0;
}

function dosDate(): number {
  // 1980-01-01 — DOS-date encoding is `((year-1980)<<9) | (month<<5) | day`.
  return (0 << 9) | (1 << 5) | 1;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] ?? 0;
    const idx = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ (CRC_TABLE[idx] ?? 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeUInt32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function writeUInt16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

/**
 * Build a complete STORED-mode ZIP archive. The result is a single
 * `Uint8Array` ready to ship as the HTTP body.
 */
export function buildZipArchive(entries: readonly ZipEntryInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const plans: ZipEntryPlan[] = [];

  let runningOffset = 0;
  let localTotal = 0;
  for (const entry of entries) {
    const filenameBytes = encoder.encode(entry.filename);
    const crc = crc32(entry.bytes);
    plans.push({
      filename: entry.filename,
      filenameBytes,
      bytes: entry.bytes,
      crc32: crc,
      localHeaderOffset: runningOffset,
    });
    const lfhSize = 30 + filenameBytes.length + entry.bytes.length;
    runningOffset += lfhSize;
    localTotal += lfhSize;
  }

  let cdSize = 0;
  for (const plan of plans) {
    cdSize += 46 + plan.filenameBytes.length;
  }

  const eocdSize = 22;
  const total = localTotal + cdSize + eocdSize;
  const buffer = new Uint8Array(total);
  const view = new DataView(buffer.buffer);
  let cursor = 0;

  // Local File Headers + bytes.
  for (const plan of plans) {
    writeUInt32LE(view, cursor, SIG_LFH);
    writeUInt16LE(view, cursor + 4, ZIP_VERSION);
    writeUInt16LE(view, cursor + 6, FLAG_UTF8);
    writeUInt16LE(view, cursor + 8, METHOD_STORED);
    writeUInt16LE(view, cursor + 10, dosTime());
    writeUInt16LE(view, cursor + 12, dosDate());
    writeUInt32LE(view, cursor + 14, plan.crc32);
    writeUInt32LE(view, cursor + 18, plan.bytes.length);
    writeUInt32LE(view, cursor + 22, plan.bytes.length);
    writeUInt16LE(view, cursor + 26, plan.filenameBytes.length);
    writeUInt16LE(view, cursor + 28, 0);
    cursor += 30;
    buffer.set(plan.filenameBytes, cursor);
    cursor += plan.filenameBytes.length;
    buffer.set(plan.bytes, cursor);
    cursor += plan.bytes.length;
  }

  const cdStart = cursor;

  // Central Directory File Headers.
  for (const plan of plans) {
    writeUInt32LE(view, cursor, SIG_CDH);
    writeUInt16LE(view, cursor + 4, ZIP_VERSION);
    writeUInt16LE(view, cursor + 6, ZIP_VERSION);
    writeUInt16LE(view, cursor + 8, FLAG_UTF8);
    writeUInt16LE(view, cursor + 10, METHOD_STORED);
    writeUInt16LE(view, cursor + 12, dosTime());
    writeUInt16LE(view, cursor + 14, dosDate());
    writeUInt32LE(view, cursor + 16, plan.crc32);
    writeUInt32LE(view, cursor + 20, plan.bytes.length);
    writeUInt32LE(view, cursor + 24, plan.bytes.length);
    writeUInt16LE(view, cursor + 28, plan.filenameBytes.length);
    writeUInt16LE(view, cursor + 30, 0);
    writeUInt16LE(view, cursor + 32, 0);
    writeUInt16LE(view, cursor + 34, 0);
    writeUInt16LE(view, cursor + 36, 0);
    writeUInt32LE(view, cursor + 38, 0);
    writeUInt32LE(view, cursor + 42, plan.localHeaderOffset);
    cursor += 46;
    buffer.set(plan.filenameBytes, cursor);
    cursor += plan.filenameBytes.length;
  }

  // End of Central Directory Record.
  writeUInt32LE(view, cursor, SIG_EOCD);
  writeUInt16LE(view, cursor + 4, 0);
  writeUInt16LE(view, cursor + 6, 0);
  writeUInt16LE(view, cursor + 8, plans.length);
  writeUInt16LE(view, cursor + 10, plans.length);
  writeUInt32LE(view, cursor + 12, cdSize);
  writeUInt32LE(view, cursor + 16, cdStart);
  writeUInt16LE(view, cursor + 20, 0);

  return buffer;
}

/**
 * Sanitise a filename for the zip entry — strips slash-prefixes,
 * traversal, NUL bytes; replaces control characters with `_`. The
 * caller is responsible for UTF-8-shape; this only normalises the
 * path component.
 */
export function safeZipFilename(input: string): string {
  // Drop NUL + control chars (< 0x20) — they break reasonable zip
  // viewers.
  // eslint-disable-next-line no-control-regex
  let out = input.replace(/[\x00-\x1f]/g, "_");
  // Strip leading slashes / drive letters so the entry sits at the
  // archive root.
  out = out.replace(/^[/\\]+/, "").replace(/^[a-zA-Z]:[/\\]/, "");
  // Collapse any `..` segments — defensive, an archive with `..` in
  // a path would let a naive extractor escape the target dir.
  out = out
    .split(/[/\\]/)
    .filter((segment) => segment !== "" && segment !== ".." && segment !== ".")
    .join("/");
  return out.length > 0 ? out : "file";
}
