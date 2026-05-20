import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Story · Dev runner — `--tunnel` wiring.
 *
 * The cloudflared spawn lives in `scripts/dev.ts` (not unit-testable
 * without booting the runner). These structural assertions guard the
 * contract: the runner imports the planner, parses argv, abort-exits
 * when cloudflared is missing, persists the URL via writeTunnelState,
 * tears the tunnel down on shutdown, and exposes the URL to the API
 * via the lock file.
 *
 * The full flow is verified manually (see `docs/dev-tunnel.md`).
 */
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const DEV_SCRIPT = readFileSync(resolve(REPO_ROOT, "scripts/dev.ts"), "utf8");

describe("Story · Dev runner — `--tunnel` wiring", () => {
  it("imports the cloudflare-tunnel planner", () => {
    expect(DEV_SCRIPT).toMatch(/from ['"]\.\.\/src\/core\/dev\/cloudflare-tunnel\.js['"]/);
    expect(DEV_SCRIPT).toMatch(/parseTunnelArgs/);
    expect(DEV_SCRIPT).toMatch(/planCloudflaredCommand/);
    expect(DEV_SCRIPT).toMatch(/parseCloudflaredOutput/);
    expect(DEV_SCRIPT).toMatch(/formatMissingCloudflaredHint/);
  });

  it("imports the tunnel-state runner so the API can read the URL via /hub/tunnel.json", () => {
    expect(DEV_SCRIPT).toMatch(/from ['"]\.\.\/src\/core\/dev\/tunnel-state-runner\.js['"]/);
    expect(DEV_SCRIPT).toMatch(/writeTunnelState/);
    expect(DEV_SCRIPT).toMatch(/clearTunnelState/);
  });

  it("parses the CLI argv via parseTunnelArgs(process.argv.slice(2))", () => {
    expect(DEV_SCRIPT).toMatch(/parseTunnelArgs\(process\.argv\.slice\(2\)\)/);
  });

  it("aborts with a clear hint when cloudflared is missing", () => {
    expect(DEV_SCRIPT).toMatch(/which\(['"]cloudflared['"]\)/);
    expect(DEV_SCRIPT).toMatch(/formatMissingCloudflaredHint\(\)/);
    expect(DEV_SCRIPT).toMatch(/process\.exit\(1\)/);
  });

  it("respects CLOUDFLARE_TUNNEL_NAME for named-tunnel mode", () => {
    expect(DEV_SCRIPT).toMatch(/CLOUDFLARE_TUNNEL_NAME/);
  });

  it("forwards SIGINT/SIGTERM to the cloudflared child for clean teardown", () => {
    // The shutdown handler must kill the tunnel process and clear the
    // state file so /hub/tunnel.json never reports a dead URL.
    expect(DEV_SCRIPT).toMatch(/tunnelChild\.kill/);
    expect(DEV_SCRIPT).toMatch(/clearTunnelState\(process\.cwd\(\)\)/);
  });

  it("writes the discovered URL to the tunnel-state lock file", () => {
    expect(DEV_SCRIPT).toMatch(/writeTunnelState\(process\.cwd\(\),/);
  });
});
