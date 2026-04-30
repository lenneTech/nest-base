import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseTunnelState,
  serializeTunnelState,
  type TunnelState,
} from "../../src/core/dev/tunnel-state.js";
import {
  clearTunnelState,
  readTunnelState,
  tunnelStateLockPath,
  writeTunnelState,
} from "../../src/core/dev/tunnel-state-runner.js";

/**
 * Story · Tunnel-state file.
 *
 * `scripts/dev.ts` (parent process, owns the cloudflared child)
 * writes the discovered tunnel URL to a JSON state file under
 * `node_modules/.cache/nest-base/tunnel.json`. The NestJS API child
 * reads it on demand via `GET /dev/tunnel.json`.
 *
 * The split mirrors `dev-session-runner.ts`: a pure planner
 * (parse / serialize) + a thin runner (file IO).
 */
describe("Story · Tunnel-state planner", () => {
  it("serializes + parses the state round-trip", () => {
    const state: TunnelState = {
      url: "https://example-1.trycloudflare.com",
      startedAt: "2026-04-30T10:00:00.000Z",
    };
    const text = serializeTunnelState(state);
    expect(parseTunnelState(text)).toEqual(state);
  });

  it("returns null on invalid JSON (corrupted lock files must not crash the API)", () => {
    expect(parseTunnelState("not-json{")).toBeNull();
  });

  it("returns null when the URL is missing or not a string", () => {
    expect(parseTunnelState(JSON.stringify({}))).toBeNull();
    expect(parseTunnelState(JSON.stringify({ url: 42 }))).toBeNull();
  });

  it("rejects non-trycloudflare URLs unless they are explicit https (named tunnels)", () => {
    expect(parseTunnelState(JSON.stringify({ url: "ftp://x.example.com" }))).toBeNull();
  });
});

describe("Story · Tunnel-state runner", () => {
  function withTempProject<T>(fn: (root: string) => T): T {
    const root = mkdtempSync(join(tmpdir(), "tunnel-state-"));
    try {
      return fn(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  it("writes and reads the state in node_modules/.cache/nest-base/tunnel.json", () => {
    withTempProject((root) => {
      const state: TunnelState = {
        url: "https://abc.trycloudflare.com",
        startedAt: "2026-04-30T10:00:00.000Z",
      };
      writeTunnelState(root, state);
      const path = tunnelStateLockPath(root);
      expect(path).toBe(resolve(root, "node_modules/.cache/nest-base/tunnel.json"));
      expect(readTunnelState(root)).toEqual(state);
    });
  });

  it("returns null when the lock file does not exist", () => {
    withTempProject((root) => {
      expect(readTunnelState(root)).toBeNull();
    });
  });

  it("returns null when the lock file is corrupted", () => {
    withTempProject((root) => {
      const path = tunnelStateLockPath(root);
      // Pre-create the parent dir before writing the corrupted payload.
      writeTunnelState(root, {
        url: "https://abc.trycloudflare.com",
        startedAt: "2026-04-30T10:00:00.000Z",
      });
      writeFileSync(path, "{not-json", "utf8");
      expect(readTunnelState(root)).toBeNull();
    });
  });

  it("clearTunnelState removes the lock file (idempotent)", () => {
    withTempProject((root) => {
      writeTunnelState(root, {
        url: "https://abc.trycloudflare.com",
        startedAt: "2026-04-30T10:00:00.000Z",
      });
      clearTunnelState(root);
      expect(readTunnelState(root)).toBeNull();
      // Calling clear again must not throw.
      clearTunnelState(root);
    });
  });
});
