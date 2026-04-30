import { passkey } from "@better-auth/passkey";
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt } from "better-auth/plugins/jwt";
import { twoFactor } from "better-auth/plugins/two-factor";

import { resolveBetterAuthMountPath } from "./better-auth-config.js";

/**
 * Better-Auth instance factory.
 *
 * Takes a validated config and returns the Better-Auth instance whose
 * `handler` function is what the NestJS adapter mounts under
 * `/api/auth/*` (Phase 2 / "Better-Auth Integration" slice).
 *
 * Storage adapter: when a `prisma` client is supplied, the factory
 * wires Better-Auth's `prismaAdapter` so users / sessions / accounts
 * / verifications persist to the Postgres tables declared in
 * `prisma/schema.prisma`. Without `prisma`, we fall back to
 * Better-Auth's built-in memory adapter — useful for the SDK / mount
 * / plugin story tests that just need a callable handler.
 */

const MIN_SECRET_LEN = 32;

export interface TwoFactorOptions {
  /** Issuer label embedded in the TOTP URI shown in authenticator apps. */
  issuer: string;
}

export interface PasskeyOptions {
  /** Human-readable relying-party label shown to users during registration. */
  rpName: string;
  /** WebAuthn relying-party id; defaults to the host of `baseUrl`. */
  rpID?: string;
}

export interface SocialProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export type SocialProviderId = "google" | "github" | "apple" | "discord";

export type SocialProviderConfig = Partial<Record<SocialProviderId, SocialProviderCredentials>>;

/**
 * Minimal Prisma surface the Better-Auth Prisma adapter requires. We
 * keep the contract structurally permissive (an opaque object) so the
 * factory stays free of a hard dependency on `@prisma/client`'s
 * generated types — `BetterAuthModule` passes its `PrismaService`
 * instance and the adapter validates the shape at call time.
 *
 * The runtime requirement is a Prisma-shaped object exposing the
 * `user / session / account / verification` model accessors plus
 * `$transaction`; documenting that here without enforcing the full
 * generic `PrismaClient<…>` type keeps the public API stable across
 * generator regenerations.
 */
export type BuildBetterAuthPrisma = object;

export interface BuildBetterAuthInput {
  secret: string;
  baseUrl: string;
  sessionExpiresInSeconds: number;
  /** Optional override; defaults to /api/auth via `resolveBetterAuthMountPath()`. */
  basePath?: string;
  /**
   * Optional Prisma client. When supplied, Better-Auth persists
   * users / sessions / accounts / verifications via
   * `better-auth/adapters/prisma`. When omitted, the built-in
   * memory adapter is used (story / SDK tests).
   */
  prisma?: BuildBetterAuthPrisma;
  /** Switch on the TOTP plugin. */
  twoFactor?: TwoFactorOptions;
  /**
   * Wire the Better-Auth `jwt` plugin.
   * `audience: 'powersync'` lets PowerSync verify the issued tokens
   * via the JWKS endpoint Better-Auth exposes at
   * `/api/auth/.well-known/jwks`.
   */
  jwtPlugin?: { audience: string };
  /** Switch on the Passkey/WebAuthn plugin. */
  passkey?: PasskeyOptions;
  /** Wire OAuth providers. */
  socialProviders?: SocialProviderConfig;
}

export function buildBetterAuth(input: BuildBetterAuthInput): ReturnType<typeof betterAuth> {
  if (input.secret.length < MIN_SECRET_LEN) {
    throw new Error(
      `Better-Auth secret must be at least ${MIN_SECRET_LEN} chars (received ${input.secret.length})`,
    );
  }
  // throws when not a parseable URL — sealed contract for the caller
  new URL(input.baseUrl);

  if (input.twoFactor && !input.twoFactor.issuer) {
    throw new Error("Better-Auth twoFactor.issuer must be a non-empty string");
  }
  if (input.passkey) {
    if (!input.passkey.rpName) {
      throw new Error("Better-Auth passkey.rpName must be a non-empty string");
    }
    if (input.passkey.rpID !== undefined && !input.passkey.rpID) {
      throw new Error("Better-Auth passkey.rpID must be a non-empty string when provided");
    }
  }
  if (input.socialProviders) {
    for (const [id, credentials] of Object.entries(input.socialProviders)) {
      if (!credentials) continue;
      if (!credentials.clientId) {
        throw new Error(`Better-Auth socialProviders.${id}.clientId must be a non-empty string`);
      }
      if (!credentials.clientSecret) {
        throw new Error(
          `Better-Auth socialProviders.${id}.clientSecret must be a non-empty string`,
        );
      }
    }
  }

  const basePath = resolveBetterAuthMountPath(input.basePath);
  const plugins: BetterAuthPlugin[] = [];
  if (input.twoFactor) plugins.push(twoFactor({ issuer: input.twoFactor.issuer }));
  if (input.jwtPlugin) {
    plugins.push(jwt({ jwt: { audience: input.jwtPlugin.audience, issuer: input.baseUrl } }));
  }
  if (input.passkey) {
    const rpID = input.passkey.rpID ?? new URL(input.baseUrl).hostname;
    plugins.push(passkey({ rpName: input.passkey.rpName, rpID, origin: input.baseUrl }));
  }
  const options: BetterAuthOptions = {
    secret: input.secret,
    baseURL: input.baseUrl,
    basePath,
    emailAndPassword: { enabled: true },
    session: {
      expiresIn: input.sessionExpiresInSeconds,
    },
    // `tenantId` is the project-specific extension on Better-Auth's
    // user table. Marked non-required so the default sign-up flow
    // works without forcing the caller to pre-pick a tenant; the
    // canonical "which tenants does this user belong to" answer is
    // the `TenantMember` join-table.
    user: {
      additionalFields: {
        tenantId: { type: "string", required: false, input: true },
      },
    },
    ...(input.prisma
      ? {
          // `provider: 'postgresql'` matches what `PrismaService` opens
          // via `@prisma/adapter-pg`. The adapter's `transaction: false`
          // default is fine — Better-Auth handles its own retry / unique
          // collision flows at the API layer.
          database: prismaAdapter(input.prisma as object, { provider: "postgresql" }),
          // The Prisma `User.id` column is declared `@db.Uuid`. Without
          // this override, Better-Auth's default ID generator emits a
          // base32 nanoid that Postgres rejects with
          // "invalid input syntax for type uuid". Switching to UUIDs
          // keeps schema and adapter aligned.
          advanced: { database: { generateId: "uuid" as const } },
        }
      : {}),
    ...(plugins.length > 0 ? { plugins } : {}),
    ...(input.socialProviders && Object.keys(input.socialProviders).length > 0
      ? { socialProviders: input.socialProviders as BetterAuthOptions["socialProviders"] }
      : {}),
  };
  return betterAuth(options);
}
