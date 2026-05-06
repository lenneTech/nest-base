/**
 * Story · Dev-Portal SPA TUS-upload helper (CF.FILES.06 — iter-109).
 *
 * Verifies the encode-metadata + create+patch round-trip the
 * `UploadDropZone` component depends on. The test runs the real
 * client against a tiny TUS-shaped HTTP fake (POST returns 201 +
 * Location, PATCH returns 204) so the client's wire format is
 * exercised end-to-end without a Bun process or testcontainer.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

// Polyfill DOM types the client touches when it runs in vitest.
class FakeXhrUpload {
  onprogress: ((ev: { loaded: number }) => void) | null = null;
}

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload = new FakeXhrUpload();
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private headers: Record<string, string> = {};
  private url = "";
  private method = "";
  // Real-network mode — pass through to fetch since vitest's
  // node env has no XHR.
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    FakeXhr.instances.push(this);
  }
  setRequestHeader(k: string, v: string): void {
    this.headers[k] = v;
  }
  async send(body: Blob | File): Promise<void> {
    try {
      // Read the body via Buffer.
      const buf = Buffer.from(await body.arrayBuffer());
      // Simulate progress (single tick, full).
      this.upload.onprogress?.({ loaded: buf.length });
      const res = await fetch(this.url, {
        method: this.method,
        headers: this.headers,
        body: buf,
      });
      this.status = res.status;
      this.responseText = await res.text();
      this.onload?.();
    } catch (err) {
      this.responseText = err instanceof Error ? err.message : String(err);
      this.onerror?.();
    }
  }
}

describe("Story · TUS upload client (dev-portal SPA)", () => {
  let server: Server;
  let baseUrl = "";
  const created: { headers: Record<string, string | string[] | undefined> }[] = [];
  const patched: { headers: Record<string, string | string[] | undefined>; bytes: number }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/api/files/upload") {
        created.push({ headers: req.headers });
        res.statusCode = 201;
        res.setHeader("Location", `/api/files/upload/abc-${created.length}`);
        res.end();
        return;
      }
      if (req.method === "PATCH" && req.url?.startsWith("/api/files/upload/")) {
        let total = 0;
        req.on("data", (c) => {
          total += c.length;
        });
        req.on("end", () => {
          patched.push({ headers: req.headers, bytes: total });
          res.statusCode = 204;
          res.end();
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("listen failed");
    baseUrl = `http://127.0.0.1:${addr.port}`;
    // Polyfills: window.location, btoa, XHR, File.
    Object.assign(globalThis, {
      window: { location: { origin: baseUrl } },
      XMLHttpRequest: FakeXhr,
      btoa: (s: string) => Buffer.from(s, "binary").toString("base64"),
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("POSTs Upload-Length + base64 metadata, then PATCHes the bytes; resolves with the Location URL", async () => {
    const { tusUpload } = await import("../../src/core/dx/clients/lib/tus-upload.js");
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "hello.bin", {
      type: "application/octet-stream",
    });
    const progressTicks: { sent: number; total: number }[] = [];
    const result = await tusUpload({
      endpoint: `${baseUrl}/api/files/upload`,
      file,
      headers: { "x-tenant-id": "abc" },
      metadata: { folderId: "f-1" },
      onProgress: (sent, total) => progressTicks.push({ sent, total }),
    });
    expect(result.uploadUrl).toMatch(/\/api\/files\/upload\/abc-\d+$/);
    expect(created.length).toBeGreaterThan(0);
    const last = created[created.length - 1]!;
    expect(last.headers["upload-length"]).toBe("5");
    expect(last.headers["tus-resumable"]).toBe("1.0.0");
    expect(last.headers["x-tenant-id"]).toBe("abc");
    // Upload-Metadata is `key base64(value),...`.
    const meta = String(last.headers["upload-metadata"]);
    expect(meta).toContain("filename ");
    expect(meta).toContain("folderId ");
    expect(patched.length).toBeGreaterThan(0);
    const patch = patched[patched.length - 1]!;
    expect(patch.bytes).toBe(5);
    expect(patch.headers["content-type"]).toBe("application/offset+octet-stream");
    expect(patch.headers["upload-offset"]).toBe("0");
    expect(progressTicks.length).toBeGreaterThan(0);
    expect(progressTicks[progressTicks.length - 1]?.total).toBe(5);
  });

  it("encodes UTF-8 filenames safely in Upload-Metadata", async () => {
    const { tusUpload } = await import("../../src/core/dx/clients/lib/tus-upload.js");
    const file = new File([new Uint8Array([0])], "über-mäßig.txt", { type: "text/plain" });
    await tusUpload({ endpoint: `${baseUrl}/api/files/upload`, file });
    const last = created[created.length - 1]!;
    const meta = String(last.headers["upload-metadata"]);
    const filenamePart = meta.split(",").find((s) => s.startsWith("filename "));
    expect(filenamePart).toBeDefined();
    const b64 = filenamePart!.slice("filename ".length);
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    expect(decoded).toBe("über-mäßig.txt");
  });

  it("rejects when the create POST does not return 201", async () => {
    const { tusUpload } = await import("../../src/core/dx/clients/lib/tus-upload.js");
    const file = new File([new Uint8Array([1])], "a.bin", { type: "application/octet-stream" });
    await expect(tusUpload({ endpoint: `${baseUrl}/nonexistent`, file })).rejects.toThrow(
      /TUS create failed/,
    );
  });
});
