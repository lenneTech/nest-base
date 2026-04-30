import { describe, expect, it } from "vitest";

import {
  buildPowerSyncJwtConfig,
  describePowerSyncJwksEndpoint,
  type PowerSyncJwtConfig,
} from "../../src/core/auth/powersync-jwt.js";

/**
 * Story · Better-Auth JWT plugin for PowerSync.
 *
 * PowerSync requires:
 *   - JWT signed by Better-Auth's JWKS keypair
 *   - `aud: powersync` so it can refuse tokens minted for the API
 *   - JWKS reachable at a stable, public URL
 *
 * `buildPowerSyncJwtConfig` is the pure planner that returns the
 * options object the Better-Auth `jwt` plugin is constructed with.
 * `describePowerSyncJwksEndpoint` returns the public route metadata
 * the AppModule wires (path, method, response shape).
 */
describe("Story · Better-Auth JWT plugin for PowerSync", () => {
  it("returns a config object with audience: powersync", () => {
    const config = buildPowerSyncJwtConfig({ baseUrl: "https://api.example.com" });
    expect(config.jwt.audience).toBe("powersync");
  });

  it("issuer is the API base URL (so PowerSync can reach JWKS)", () => {
    const config = buildPowerSyncJwtConfig({ baseUrl: "https://api.example.com" });
    expect(config.jwt.issuer).toBe("https://api.example.com");
  });

  it("exposes a custom claim with userId and tenantId for the bucket params", () => {
    const config = buildPowerSyncJwtConfig({ baseUrl: "https://api.example.com" });
    const claims = config.jwt.definePayload({ userId: "u1", tenantId: "t1" });
    expect(claims).toMatchObject({ sub: "u1", tenantId: "t1" });
  });

  it("uses RS256 (asymmetric, JWKS-verifiable)", () => {
    const config = buildPowerSyncJwtConfig({ baseUrl: "https://api.example.com" });
    expect(config.jwks.algorithm).toBe("RS256");
  });

  it("JWKS endpoint metadata is GET /.well-known/jwks (RFC 7517)", () => {
    const meta = describePowerSyncJwksEndpoint();
    expect(meta.method).toBe("GET");
    expect(meta.path).toBe("/.well-known/jwks");
    expect(meta.public).toBe(true); // PowerSync fetches without auth
  });

  it("JWKS endpoint exposes the response content-type so reverse-proxies cache it", () => {
    const meta = describePowerSyncJwksEndpoint();
    expect(meta.contentType).toBe("application/jwk-set+json");
  });

  it("config refuses an empty baseUrl (PowerSync would never reach JWKS)", () => {
    expect(() => buildPowerSyncJwtConfig({ baseUrl: "" })).toThrow(/baseUrl/);
  });

  it("returns a stable, immutable shape (TS interface match)", () => {
    const config = buildPowerSyncJwtConfig({ baseUrl: "https://api.example.com" });
    const _typed: PowerSyncJwtConfig = config;
    void _typed;
  });
});
