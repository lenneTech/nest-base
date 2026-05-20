import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPortlessProxyStartArgs,
  readPortlessProxyState,
} from "../../src/core/dev/portless-proxy-runner.js";

describe("Story · portless proxy runner", () => {
  it("buildPortlessProxyStartArgs defaults to proxy start on :443", () => {
    expect(buildPortlessProxyStartArgs()).toEqual(["proxy", "start"]);
  });

  it("buildPortlessProxyStartArgs can target an unprivileged HTTPS fallback port", () => {
    expect(buildPortlessProxyStartArgs({ preferFallback: true, fallbackPort: 1355 })).toEqual([
      "proxy",
      "start",
      "-p",
      "1355",
      "--https",
    ]);
  });

  it("readPortlessProxyState reads proxy.port and proxy.tls from state dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "portless-proxy-"));
    writeFileSync(join(dir, "proxy.port"), "1355");
    writeFileSync(join(dir, "proxy.pid"), "12345");
    writeFileSync(join(dir, "proxy.tls"), "1");
    const state = readPortlessProxyState(dir);
    expect(state?.port).toBe(1355);
    expect(state?.tls).toBe(true);
    expect(state?.pid).toBe(12_345);
  });
});
