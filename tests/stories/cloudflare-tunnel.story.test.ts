import { describe, expect, it } from "vitest";

import {
  formatMissingCloudflaredHint,
  parseCloudflaredOutput,
  parseTunnelArgs,
  planCloudflaredCommand,
  planTunnelEnvWrite,
} from "../../src/core/dev/cloudflare-tunnel.js";

/**
 * Story · Cloudflare-Tunnel planner.
 *
 * Pure planners feeding `scripts/dev.ts`'s tunnel orchestration:
 *
 * - `parseTunnelArgs`        — argv parsing for `--tunnel`,
 *                              `--no-tunnel`, `--tunnel-write-env`
 * - `planCloudflaredCommand` — argv builder for `cloudflared`
 *                              (quick-tunnel default + named-tunnel
 *                              opt-in via `CLOUDFLARE_TUNNEL_NAME`)
 * - `parseCloudflaredOutput` — extracts the
 *                              `https://*.trycloudflare.com` URL from
 *                              cloudflared's stderr/stdout
 * - `formatMissingCloudflaredHint` — install instructions
 * - `planTunnelEnvWrite`     — `.env` line for `--tunnel-write-env`
 */
describe("Story · Cloudflare-Tunnel planner", () => {
  describe("parseTunnelArgs()", () => {
    it("returns tunnelEnabled=false by default", () => {
      expect(parseTunnelArgs([])).toEqual({ tunnelEnabled: false, writeEnv: false });
    });

    it("recognises `--tunnel` as enable", () => {
      expect(parseTunnelArgs(["--tunnel"])).toEqual({ tunnelEnabled: true, writeEnv: false });
    });

    it("recognises `--no-tunnel` as explicit opt-out (overrides any earlier --tunnel)", () => {
      expect(parseTunnelArgs(["--tunnel", "--no-tunnel"])).toEqual({
        tunnelEnabled: false,
        writeEnv: false,
      });
    });

    it("recognises `--tunnel-write-env` and implies tunnel-on", () => {
      expect(parseTunnelArgs(["--tunnel-write-env"])).toEqual({
        tunnelEnabled: true,
        writeEnv: true,
      });
    });

    it("ignores unrelated arguments", () => {
      expect(parseTunnelArgs(["--watch", "src/main.ts", "--tunnel"])).toEqual({
        tunnelEnabled: true,
        writeEnv: false,
      });
    });
  });

  describe("planCloudflaredCommand()", () => {
    it("uses quick-tunnel by default (no account, ephemeral *.trycloudflare.com URL)", () => {
      const plan = planCloudflaredCommand({ port: 3000 });
      expect(plan.command).toBe("cloudflared");
      expect(plan.args).toEqual(["tunnel", "--url", "http://localhost:3000"]);
    });

    it("respects an explicit port", () => {
      const plan = planCloudflaredCommand({ port: 4711 });
      expect(plan.args).toEqual(["tunnel", "--url", "http://localhost:4711"]);
    });

    it("uses named-tunnel form when CLOUDFLARE_TUNNEL_NAME is set", () => {
      const plan = planCloudflaredCommand({ port: 3000, tunnelName: "my-stable-tunnel" });
      expect(plan.command).toBe("cloudflared");
      expect(plan.args).toEqual(["tunnel", "run", "my-stable-tunnel"]);
    });

    it("trims whitespace in the tunnel name (env vars are user-supplied)", () => {
      const plan = planCloudflaredCommand({ port: 3000, tunnelName: "  whitespace-name  " });
      expect(plan.args).toEqual(["tunnel", "run", "whitespace-name"]);
    });

    it("falls back to quick-tunnel when tunnelName is empty/whitespace", () => {
      const plan = planCloudflaredCommand({ port: 3000, tunnelName: "   " });
      expect(plan.args).toEqual(["tunnel", "--url", "http://localhost:3000"]);
    });

    it("rejects invalid ports (not a positive integer)", () => {
      expect(() => planCloudflaredCommand({ port: 0 })).toThrow(/port/i);
      expect(() => planCloudflaredCommand({ port: -1 })).toThrow(/port/i);
      expect(() => planCloudflaredCommand({ port: 1.5 })).toThrow(/port/i);
    });
  });

  describe("parseCloudflaredOutput()", () => {
    it("returns ready=false on a noisy boot line that has no URL", () => {
      const result = parseCloudflaredOutput("2026-04-30T10:00:00Z INF Starting tunnel");
      expect(result.url).toBeUndefined();
      expect(result.ready).toBe(false);
    });

    it("extracts the trycloudflare URL from the modern `Your quick Tunnel` banner", () => {
      const line = "|  https://example-cute-name-123.trycloudflare.com                       |";
      const result = parseCloudflaredOutput(line);
      expect(result.url).toBe("https://example-cute-name-123.trycloudflare.com");
      expect(result.ready).toBe(true);
    });

    it("extracts the URL from the inline log form", () => {
      const line =
        "2026-04-30T10:00:01Z INF +--------------------------------------+ url=https://red-flame-7hk.trycloudflare.com";
      const result = parseCloudflaredOutput(line);
      expect(result.url).toBe("https://red-flame-7hk.trycloudflare.com");
      expect(result.ready).toBe(true);
    });

    it("extracts the URL from a structured JSON-ish stderr line", () => {
      const line =
        '{"level":"info","time":"2026-04-30T10:00:01Z","msg":"Connection registered","url":"https://blue-mountain-8.trycloudflare.com"}';
      const result = parseCloudflaredOutput(line);
      expect(result.url).toBe("https://blue-mountain-8.trycloudflare.com");
    });

    it("extracts the URL when surrounded by ANSI color codes", () => {
      const line =
        "\x1b[32mINFO\x1b[0m  https://orange-coast-42.trycloudflare.com  is the public URL";
      const result = parseCloudflaredOutput(line);
      expect(result.url).toBe("https://orange-coast-42.trycloudflare.com");
    });

    it("flags an error when cloudflared writes a known failure line", () => {
      const result = parseCloudflaredOutput("ERR Failed to dial to edge: connection refused");
      expect(result.error).toMatch(/failed/i);
      expect(result.ready).toBe(false);
      expect(result.url).toBeUndefined();
    });

    it("ignores `cloudflared.com` (marketing URL) — only `trycloudflare.com` counts", () => {
      const result = parseCloudflaredOutput("Visit https://cloudflared.com for docs");
      expect(result.url).toBeUndefined();
    });

    it("handles multiple URLs on one line by returning the first match", () => {
      const result = parseCloudflaredOutput(
        "old https://abc.trycloudflare.com new https://xyz.trycloudflare.com",
      );
      expect(result.url).toBe("https://abc.trycloudflare.com");
    });
  });

  describe("formatMissingCloudflaredHint()", () => {
    it("includes the Homebrew install command for macOS users", () => {
      const hint = formatMissingCloudflaredHint();
      expect(hint).toMatch(/brew install cloudflared/);
    });

    it("links to the GitHub releases for non-brew installs", () => {
      const hint = formatMissingCloudflaredHint();
      expect(hint).toMatch(/github\.com\/cloudflare\/cloudflared/);
    });

    it("explains why the tunnel cannot start (so the user knows it is a hard requirement)", () => {
      const hint = formatMissingCloudflaredHint();
      expect(hint.toLowerCase()).toContain("cloudflared");
    });
  });

  describe("planTunnelEnvWrite()", () => {
    it("returns a single TUNNEL_PUBLIC_URL line when the .env is empty", () => {
      const plan = planTunnelEnvWrite({
        current: "",
        url: "https://example-1.trycloudflare.com",
      });
      expect(plan.next).toContain("TUNNEL_PUBLIC_URL=https://example-1.trycloudflare.com");
    });

    it("appends TUNNEL_PUBLIC_URL when the key is missing", () => {
      const plan = planTunnelEnvWrite({
        current: "FOO=bar\n",
        url: "https://example-2.trycloudflare.com",
      });
      expect(plan.next).toBe("FOO=bar\nTUNNEL_PUBLIC_URL=https://example-2.trycloudflare.com\n");
    });

    it("replaces an existing TUNNEL_PUBLIC_URL value in place", () => {
      const plan = planTunnelEnvWrite({
        current: "FOO=bar\nTUNNEL_PUBLIC_URL=https://stale.trycloudflare.com\nBAZ=qux\n",
        url: "https://fresh.trycloudflare.com",
      });
      expect(plan.next).toBe(
        "FOO=bar\nTUNNEL_PUBLIC_URL=https://fresh.trycloudflare.com\nBAZ=qux\n",
      );
    });

    it("rejects non-trycloudflare URLs (defense-in-depth — never write arbitrary user URLs to .env)", () => {
      expect(() => planTunnelEnvWrite({ current: "", url: "https://evil.example.com" })).toThrow(
        /trycloudflare/i,
      );
    });

    it("rejects URLs with newline injection", () => {
      expect(() =>
        planTunnelEnvWrite({
          current: "",
          url: "https://example.trycloudflare.com\nMALICIOUS=1",
        }),
      ).toThrow();
    });

    it("accepts a named-tunnel custom domain via opt-in flag (advanced use)", () => {
      const plan = planTunnelEnvWrite({
        current: "",
        url: "https://api.example.com",
        allowAnyHttps: true,
      });
      expect(plan.next).toContain("TUNNEL_PUBLIC_URL=https://api.example.com");
    });
  });
});
