import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = resolve(import.meta.dirname, "..", "..");

interface ComposeService {
  image?: string;
  command?: string | string[];
  environment?: Record<string, string> | string[];
  ports?: Array<string | number>;
  depends_on?: string[] | Record<string, unknown>;
  volumes?: string[];
  healthcheck?: { test: string | string[] };
}

interface Compose {
  services: Record<string, ComposeService>;
}

/**
 * Story · PowerSync service in docker-compose.
 *
 * The PowerSync sync engine runs as a sidecar container that pulls
 * the WAL from Postgres, applies sync-rules.yaml, and exposes a
 * WebSocket endpoint mobile clients connect to. We test the compose
 * wiring here so the local dev environment matches the deployment
 * topology.
 */
describe("Story · PowerSync service in docker-compose", () => {
  function readCompose(): Compose {
    const composePath = resolve(ROOT, "docker-compose.yml");
    expect(existsSync(composePath), "docker-compose.yml must exist").toBe(true);
    return parse(readFileSync(composePath, "utf8")) as Compose;
  }

  it("declares a powersync service", () => {
    const c = readCompose();
    expect(c.services.powersync, "powersync service must be defined").toBeDefined();
  });

  it("uses the official journeyapps powersync image", () => {
    const c = readCompose();
    expect(c.services.powersync?.image).toMatch(/journeyapps\/powersync-service/);
  });

  it("depends on postgres so the WAL is available before powersync boots", () => {
    const c = readCompose();
    const dep = c.services.powersync?.depends_on;
    if (Array.isArray(dep)) {
      expect(dep).toContain("postgres");
    } else if (dep && typeof dep === "object") {
      expect(Object.keys(dep)).toContain("postgres");
    } else {
      throw new Error("powersync.depends_on must be set");
    }
  });

  it("exposes the PowerSync HTTP/WebSocket port (default 8080)", () => {
    const c = readCompose();
    const ports = c.services.powersync?.ports?.map((p) => String(p)) ?? [];
    expect(ports.some((p) => p.includes("8080"))).toBe(true);
  });

  it("mounts the PowerSync config directory read-only", () => {
    const c = readCompose();
    const volumes = c.services.powersync?.volumes ?? [];
    expect(volumes.some((v) => v.includes("docker/powersync"))).toBe(true);
    expect(volumes.some((v) => v.includes("docker/powersync") && v.endsWith(":ro"))).toBe(true);
  });

  it("points the service at powersync.yaml and supplies Postgres + JWKS via PS_* env", () => {
    const c = readCompose();
    const env = c.services.powersync?.environment;
    const flat = Array.isArray(env)
      ? env.join(" ")
      : Object.entries(env ?? {})
          .map(([k, v]) => `${k}=${v}`)
          .join(" ");
    expect(flat).toMatch(/POWERSYNC_CONFIG_PATH/);
    expect(flat).toMatch(/PS_PG_URI/);
    expect(flat).toMatch(/PS_JWKS_URL|JWKS/i);
  });
});
