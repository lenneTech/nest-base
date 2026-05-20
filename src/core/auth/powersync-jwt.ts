/**
 * PowerSync JWT + JWKS planner.
 *
 * Pure planner. Returns the options bag that the Better-Auth `jwt`
 * plugin is constructed with, plus the public-route metadata for the
 * JWKS endpoint. The runner (in better-auth-config.ts) plugs the
 * config into the live Better-Auth instance; the AppModule mounts the
 * JWKS route based on the metadata.
 *
 * Two security decisions are pinned here:
 *   - `audience: powersync` so PowerSync can reject API-only tokens
 *     and the API can reject PowerSync-only tokens.
 *   - RS256 + JWKS rotation: PowerSync verifies via the public key set,
 *     never via a shared secret.
 */

import { SINGLE_TENANT_ID } from "./powersync-tenant.js";

export interface PowerSyncJwtClaims {
  sub: string;
  tenantId?: string;
  aud: string;
  iss: string;
}

export interface PowerSyncJwtConfig {
  jwt: {
    audience: string;
    issuer: string;
    definePayload: (input: {
      userId: string;
      tenantId?: string;
    }) => Pick<PowerSyncJwtClaims, "sub" | "tenantId">;
  };
  jwks: {
    algorithm: "RS256";
  };
}

export interface PowerSyncJwksEndpoint {
  method: "GET";
  path: "/.well-known/jwks";
  public: true;
  contentType: "application/jwk-set+json";
}

export function buildPowerSyncJwtConfig(input: {
  baseUrl: string;
  /**
   * `features.multiTenancy.enabled`. When omitted, defaults to the
   * multi-tenant behaviour so existing call-sites stay byte-identical.
   * When `false`, every token carries the single-tenant sentinel claim
   * so PowerSync's `tenant` bucket resolves deterministically (it
   * returns no rows in single-tenant mode — harmless) while the `user`
   * bucket continues to carry per-user data tenant-lessly.
   */
  multiTenancyEnabled?: boolean;
}): PowerSyncJwtConfig {
  if (!input.baseUrl) {
    throw new Error("powersync-jwt: baseUrl is required so PowerSync can reach JWKS");
  }
  const singleTenant = input.multiTenancyEnabled === false;
  return {
    jwt: {
      audience: "powersync",
      issuer: input.baseUrl,
      definePayload: ({ userId, tenantId }) => {
        if (singleTenant) {
          return { sub: userId, tenantId: SINGLE_TENANT_ID };
        }
        return tenantId ? { sub: userId, tenantId } : { sub: userId };
      },
    },
    jwks: { algorithm: "RS256" },
  };
}

export function describePowerSyncJwksEndpoint(): PowerSyncJwksEndpoint {
  return {
    method: "GET",
    path: "/.well-known/jwks",
    public: true,
    contentType: "application/jwk-set+json",
  };
}
