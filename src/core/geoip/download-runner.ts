import { gunzipSync } from "node:zlib";
import { dirname } from "node:path";

import type { GeoIpDownloadPlan } from "./download-planner.js";

/**
 * GeoIp Download Runner.
 *
 * Thin glue around the planner + Node's built-ins. Fetches the URL,
 * decompresses the archive (`gz` for dbip-lite, `tar.gz` for
 * MaxMind), extracts the `.mmdb` payload, writes it to `savePath`.
 *
 * `fetch` and `fs` are injected so unit tests don't hit the network
 * or touch the filesystem. Production wiring uses `globalThis.fetch`
 * + `node:fs/promises`.
 */

export interface RunnerFetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface RunnerFs {
  mkdir(path: string, opts: { recursive: boolean }): Promise<unknown>;
  writeFile(path: string, bytes: Uint8Array): Promise<unknown>;
}

export interface RunnerDeps {
  fetch: (url: string) => Promise<RunnerFetchResponse>;
  fs: RunnerFs;
}

export interface RunnerResult {
  savePath: string;
  bytesWritten: number;
}

export class GeoIpDownloadFailedError extends Error {
  constructor(url: string, status: number) {
    super(`GeoIP download failed: HTTP ${status} for ${url}`);
    this.name = "GeoIpDownloadFailedError";
  }
}

export class GeoIpArchiveExtractError extends Error {
  constructor(message: string) {
    super(`GeoIP archive extract failed: ${message}`);
    this.name = "GeoIpArchiveExtractError";
  }
}

export async function runGeoIpDownload(
  plan: GeoIpDownloadPlan,
  deps: RunnerDeps,
): Promise<RunnerResult> {
  const response = await deps.fetch(plan.url);
  if (!response.ok) {
    throw new GeoIpDownloadFailedError(plan.url, response.status);
  }
  const archive = Buffer.from(await response.arrayBuffer());
  const mmdb = extractMmdb(archive, plan.archiveFormat);

  await deps.fs.mkdir(dirname(plan.savePath), { recursive: true });
  await deps.fs.writeFile(plan.savePath, mmdb);

  return { savePath: plan.savePath, bytesWritten: mmdb.length };
}

function extractMmdb(archive: Buffer, format: GeoIpDownloadPlan["archiveFormat"]): Buffer {
  if (format === "gz") {
    return gunzipSync(archive);
  }
  if (format === "tar.gz") {
    const tar = gunzipSync(archive);
    const mmdb = findMmdbInTar(tar);
    if (!mmdb) {
      throw new GeoIpArchiveExtractError("no .mmdb entry found in tar archive");
    }
    return mmdb;
  }
  throw new GeoIpArchiveExtractError(`unsupported archive format: ${format}`);
}

/**
 * Walk a POSIX-tar buffer and return the first `*.mmdb` file body.
 *
 * Format reference: USTAR — header is 512 bytes, payload follows in
 * 512-byte-aligned blocks, archive ends with two zero blocks.
 *
 * `name` (0..100), `size` (124..136, octal), `typeflag` (156).
 */
function findMmdbInTar(tar: Buffer): Buffer | null {
  const blockSize = 512;
  let offset = 0;
  while (offset + blockSize <= tar.length) {
    const header = tar.subarray(offset, offset + blockSize);
    // Two consecutive zero blocks → end-of-archive.
    if (header.every((b) => b === 0)) break;

    const name = readCString(header.subarray(0, 100));
    const size = parseTarOctal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156]!);
    offset += blockSize;

    // Regular file ("0" or "\0") with .mmdb extension.
    if ((typeflag === "0" || typeflag === "\0") && name.endsWith(".mmdb")) {
      return tar.subarray(offset, offset + size);
    }

    // Skip the body block (rounded up to nearest 512).
    offset += Math.ceil(size / blockSize) * blockSize;
  }
  return null;
}

function readCString(buf: Buffer): string {
  const nul = buf.indexOf(0);
  return (nul === -1 ? buf : buf.subarray(0, nul)).toString("utf8");
}

function parseTarOctal(buf: Buffer): number {
  // tar octal fields are NUL- or space-terminated ASCII octal numbers.
  const str = buf.toString("ascii").replace(/[\0 ]+$/, "").trim();
  if (!str) return 0;
  return Number.parseInt(str, 8);
}
