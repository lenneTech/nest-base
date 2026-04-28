import { type BetterAuthOptions, betterAuth } from 'better-auth';

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

export interface BuildBetterAuthInput {
  secret: string;
  baseUrl: string;
  sessionExpiresInSeconds: number;
  /** Optional override; defaults to /api/auth via `resolveBetterAuthMountPath()`. */
  basePath?: string;
}

export function buildBetterAuth(input: BuildBetterAuthInput): ReturnType<typeof betterAuth> {
  if (input.secret.length < MIN_SECRET_LEN) {
    throw new Error(`Better-Auth secret must be at least ${MIN_SECRET_LEN} chars (received ${input.secret.length})`);
  }
  // throws when not a parseable URL — sealed contract for the caller
  new URL(input.baseUrl);

  const basePath = resolveBetterAuthMountPath(input.basePath);
  const options: BetterAuthOptions = {
    secret: input.secret,
    baseURL: input.baseUrl,
    basePath,
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: input.sessionExpiresInSeconds,
    },
  };
  return betterAuth(options);
}
