import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import { runGeoIpDownload } from "../../src/core/geoip/download-runner.js";

/**
 * Story · GeoIp Download Runner
 *
 * Wraps the planner: fetches the URL, decompresses based on
 * `archiveFormat`, writes to `savePath`. Both fetch and fs are
 * injected — tests don't hit the network or touch disk.
 *
 * `tar.gz` (MaxMind) is decompressed by lazy-importing
 * `node:zlib` + walking the tar headers. The test harness only
 * exercises the `gz` path (dbip-lite); MaxMind format coverage
 * happens in the planner test.
 */
describe("Story · GeoIp Download Runner", () => {
  it("lädt dbip-lite, dekomprimiert .gz, schreibt savePath", async () => {
    const mmdbBytes = Buffer.from([0xab, 0xcd, 0xef]); // dummy
    const gz = gzipSync(mmdbBytes);
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)),
    }));
    const writes: { path: string; bytes: Uint8Array }[] = [];
    const fs = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (path: string, bytes: Uint8Array) => {
        writes.push({ path, bytes });
      }),
    };

    const result = await runGeoIpDownload(
      {
        provider: "dbip-lite",
        url: "https://download.db-ip.com/free/dbip-city-lite-2026-04.mmdb.gz",
        savePath: "/tmp/test/city.mmdb",
        archiveFormat: "gz",
        cadence: "monthly",
        requiresLicenseKey: false,
        licenseLabel: "CC-BY-4.0 (db-ip.com)",
      },
      { fetch: fetcher, fs },
    );

    expect(result.bytesWritten).toBe(mmdbBytes.length);
    expect(result.savePath).toBe("/tmp/test/city.mmdb");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fs.mkdir).toHaveBeenCalledWith("/tmp/test", { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledOnce();
    expect(writes[0]?.path).toBe("/tmp/test/city.mmdb");
    expect(Buffer.compare(writes[0]!.bytes, mmdbBytes)).toBe(0);
  });

  it("wirft, wenn der HTTP-Status nicht ok ist", async () => {
    const fetcher = vi.fn(async () => ({
      ok: false,
      status: 404,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));
    const fs = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
    };

    await expect(
      runGeoIpDownload(
        {
          provider: "dbip-lite",
          url: "https://download.db-ip.com/free/missing.mmdb.gz",
          savePath: "/tmp/test/city.mmdb",
          archiveFormat: "gz",
          cadence: "monthly",
          requiresLicenseKey: false,
          licenseLabel: "CC-BY-4.0 (db-ip.com)",
        },
        { fetch: fetcher, fs },
      ),
    ).rejects.toThrow(/404/);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("dekomprimiert tar.gz und extrahiert das *.mmdb-File", async () => {
    // Ein minimal-tar mit einer einzigen Datei `GeoLite2-City_20260401/GeoLite2-City.mmdb`.
    const mmdbBytes = Buffer.from("MMDB-PAYLOAD-EXAMPLE");
    const tar = makeMinimalTar(
      "GeoLite2-City_20260401/GeoLite2-City.mmdb",
      mmdbBytes,
    );
    const gz = gzipSync(tar);
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: () => Promise.resolve(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength)),
    }));
    let writtenBytes: Uint8Array | undefined;
    const fs = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async (_path: string, bytes: Uint8Array) => {
        writtenBytes = bytes;
      }),
    };

    const result = await runGeoIpDownload(
      {
        provider: "maxmind",
        url: "https://download.maxmind.com/app/geoip_download?...",
        savePath: "/tmp/test/city.mmdb",
        archiveFormat: "tar.gz",
        cadence: "weekly",
        requiresLicenseKey: true,
        licenseLabel: "MaxMind GeoLite2-City EULA",
      },
      { fetch: fetcher, fs },
    );

    expect(result.bytesWritten).toBe(mmdbBytes.length);
    expect(writtenBytes).toBeDefined();
    expect(Buffer.compare(writtenBytes!, mmdbBytes)).toBe(0);
  });
});

/**
 * Build a minimal POSIX-tar archive containing exactly one file at
 * `name` with `body`. Pads to 512-byte blocks. Sufficient for the
 * runner's tar walker — no extended headers, no longlinks.
 */
function makeMinimalTar(name: string, body: Buffer): Buffer {
  const blockSize = 512;
  const header = Buffer.alloc(blockSize);
  header.write(name, 0, 100, "utf8");
  header.write("0000644", 100, 8, "ascii"); // mode
  header.write("0000000", 108, 8, "ascii"); // uid
  header.write("0000000", 116, 8, "ascii"); // gid
  header.write(body.length.toString(8).padStart(11, "0") + " ", 124, 12, "ascii"); // size (octal)
  header.write("00000000000 ", 136, 12, "ascii"); // mtime
  header.write("        ", 148, 8, "ascii"); // checksum (spaces during calc)
  header.write("0", 156, 1, "ascii"); // typeflag = regular file
  header.write("ustar  \0", 257, 8, "ascii"); // magic
  // checksum
  let sum = 0;
  for (let i = 0; i < blockSize; i++) sum += header[i]!;
  const cs = sum.toString(8).padStart(6, "0");
  header.write(cs, 148, 6, "ascii");
  header.write("\0 ", 154, 2, "ascii");

  const padding = Buffer.alloc((blockSize - (body.length % blockSize)) % blockSize);
  // Two zero-blocks terminate the archive.
  const trailer = Buffer.alloc(blockSize * 2);
  return Buffer.concat([header, body, padding, trailer]);
}
