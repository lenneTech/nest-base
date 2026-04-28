import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins/two-factor';

import { resolveBetterAuthMountPath } from './better-auth-config.js';

/**
 * Better-Auth instance factory.
 *
 * Takes a validated config and returns the Better-Auth instance whose
 * `handler` function is what the NestJS adapter mounts under
 * `/api/auth/*` (Phase 2 / "Better-Auth Integration" slice).
 *
 * Storage adapter: in this iteration we use Better-Auth's built-in
 * memory adapter so factory + tests stay DB-free. The Prisma adapter
 * gets wired in once Better-Auth's schema migrations land alongside the
 * existing User / Tenant / Role tables.
 */

const MIN_SECRET_LEN = 32;

export interface TwoFactorOptions {
  /** Issuer label embedded in the TOTP URI shown in authenticator apps. */
  issuer: string;
}

export interface BuildBetterAuthInput {
  secret: string;
  baseUrl: string;
  sessionExpiresInSeconds: number;
  /** Optional override; defaults to /api/auth via `resolveBetterAuthMountPath()`. */
  basePath?: string;
  /** Switch on the TOTP plugin (PLAN.md §32 Phase 6 / 2FA-Endpunkte). */
  twoFactor?: TwoFactorOptions;
}

export function buildBetterAuth(input: BuildBetterAuthInput): ReturnType<typeof betterAuth> {
  if (input.secret.length < MIN_SECRET_LEN) {
    throw new Error(`Better-Auth secret must be at least ${MIN_SECRET_LEN} chars (received ${input.secret.length})`);
  }
  // throws when not a parseable URL — sealed contract for the caller
  new URL(input.baseUrl);

  if (input.twoFactor && !input.twoFactor.issuer) {
    throw new Error('Better-Auth twoFactor.issuer must be a non-empty string');
  }

  const basePath = resolveBetterAuthMountPath(input.basePath);
  const plugins = input.twoFactor ? [twoFactor({ issuer: input.twoFactor.issuer })] : undefined;
  const options: BetterAuthOptions = {
    secret: input.secret,
    baseURL: input.baseUrl,
    basePath,
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: input.sessionExpiresInSeconds,
    },
    ...(plugins ? { plugins } : {}),
  };
  return betterAuth(options);
}
