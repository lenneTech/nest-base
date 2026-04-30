import { describe, expect, it, vi } from "vitest";

import { AssetPresetRegistry } from "../../src/core/files/asset-presets.js";
import { createIpxAssetServer } from "../../src/core/files/ipx-server.js";
import { InMemoryStorageAdapter } from "../../src/core/files/storage-adapter.js";
import { emerald8x8Png } from "../lib/png-fixture.js";

/**
 * Story · IpxAssetServer middleware.
 *
 * Edge cases the e2e spec doesn't reach:
 *   - non-GET / non-HEAD requests fall through via `next()` so the
 *     admin `DELETE /_ipx/cache/:key` controller can claim them.
 *   - non-GET / non-HEAD requests with no `next` send a bare 404.
 *   - unknown preset rewrites map to a JSON 404 body before IPX runs.
 */
describe("Story · IpxAssetServer", () => {
  function setup() {
    const origin = new InMemoryStorageAdapter();
    const presets = AssetPresetRegistry.fromDefaults();
    const server = createIpxAssetServer({ origin, presets });
    return { origin, presets, server };
  }

  function fakeReq(method: string, url: string): unknown {
    return { method, url };
  }

  function fakeRes(): {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
    setHeader: (k: string, v: string) => void;
    end: (chunk?: unknown) => void;
  } {
    const res = {
      statusCode: 200,
      headers: {} as Record<string, string>,
      body: "",
      setHeader(k: string, v: string): void {
        this.headers[k.toLowerCase()] = v;
      },
      end(chunk?: unknown): void {
        if (typeof chunk === "string") this.body = chunk;
      },
    };
    return res;
  }

  it("forwards non-GET requests to the next() handler when present", () => {
    const { server } = setup();
    const next = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.handle(fakeReq("DELETE", "/cache/foo") as any, fakeRes() as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns a bare 404 when a non-GET arrives without a next() callback", () => {
    const { server } = setup();
    const res = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.handle(fakeReq("DELETE", "/cache/foo") as any, res as any);
    expect(res.statusCode).toBe(404);
  });

  it("emits a JSON 404 body when an unknown preset is referenced", async () => {
    const { server, origin } = setup();
    // The bytes don't matter — IPX should never see this request because
    // the preset rewrite throws first.
    await origin.put({ key: "x", body: emerald8x8Png(), mimeType: "image/png" });
    const res = fakeRes();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.handle(fakeReq("GET", "/preset_nope/x") as any, res as any);
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe("asset_preset_not_found");
  });
});
