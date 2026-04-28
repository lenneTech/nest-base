/**
 * PowerSync JWT + JWKS planner (PLAN.md §15.5 + §32 Phase 5b).
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
    definePayload: (input: { userId: string; tenantId?: string }) => Pick<
      PowerSyncJwtClaims,
      'sub' | 'tenantId'
    >;
  };
  jwks: {
    algorithm: 'RS256';
  };
}

export interface PowerSyncJwksEndpoint {
  method: 'GET';
  path: '/.well-known/jwks';
  public: true;
  contentType: 'application/jwk-set+json';
}

export function buildPowerSyncJwtConfig(input: { baseUrl: string }): PowerSyncJwtConfig {
  if (!input.baseUrl) {
    throw new Error('powersync-jwt: baseUrl is required so PowerSync can reach JWKS');
  }
  return {
    jwt: {
      audience: 'powersync',
      issuer: input.baseUrl,
      definePayload: ({ userId, tenantId }) =>
        tenantId ? { sub: userId, tenantId } : { sub: userId },
    },
    jwks: { algorithm: 'RS256' },
  };
}

export function describePowerSyncJwksEndpoint(): PowerSyncJwksEndpoint {
  return {
    method: 'GET',
    path: '/.well-known/jwks',
    public: true,
    contentType: 'application/jwk-set+json',
  };
}
