import { passkey } from "@better-auth/passkey";
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
// `one-tap` and `open-api` lack subpath exports in better-auth 1.6's
// package.json — they're only exposed via the umbrella `better-auth/plugins`
// entry. The other 4 plugins have stable subpath exports.
import { admin } from "better-auth/plugins/admin";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { oneTap, openAPI } from "better-auth/plugins";
import { organization } from "better-auth/plugins/organization";
import { twoFactor } from "better-auth/plugins/two-factor";

import type { DeviceHandlingRunner } from "../devices/device-handling.runner.js";
import { validatePasswordPolicy } from "./password-policy.js";
import { isPreHashedSha256 } from "./prehashed-password.js";
import { resolveBetterAuthMountPath } from "./better-auth-config.js";
import {
  createEmailHookRunner,
  type EmailSenderForHooks,
} from "./better-auth-email-hooks.runner.js";
import type { NewDeviceThrottle } from "../devices/new-device-throttle.js";

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

// Better-Auth recommendation: ≥ 64 chars ensures sufficient entropy for
// HMAC-SHA256 session signing. 32-char secrets are technically valid but
// leave less headroom against brute-force on short inputs.
// Exported so BetterAuthModule can import the same constant — one source
// of truth prevents the module-guard and the factory from diverging again.
export const MIN_SECRET_LEN = 64;

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
  /**
   * Wire Better-Auth's email hooks (verification, reset, welcome) to a
   * caller-supplied `EmailService`. When omitted, Better-Auth falls
   * back to its built-in default — currently a no-op fake.
   */
  emailHooks?: EmailHooksOptions;
  /**
   * Optional device-handling runner (issue #13). When wired, every
   * session-create lands in `runner.handleSessionCreated(...)` so
   * the system can fingerprint the device, look up the user's
   * other sessions, send a "new device" email, and revoke the
   * oldest session above the per-user cap.
   */
  deviceHandling?: { runner: DeviceHandlingRunner };
  /**
   * Optional user-created audit sink (issue #99). When wired, every
   * user creation — regardless of path (sign-up, admin create-user,
   * plugin) — invokes the callback after the user row lands in the DB.
   * The callback is responsible for writing the audit row to the
   * `audit_log` table. Typically supplied by `BetterAuthModule` using
   * `PrismaService.$executeRaw`.
   */
  userCreatedAudit?: {
    onUserCreated: (user: { id: string; tenantId?: string | null }) => Promise<void>;
  };
  /**
   * Password policy enforcement (CF.AUTH.passwordPolicy). When
   * supplied, every Better-Auth signup / change-password flow runs
   * the password through `validatePasswordPolicy` before hashing —
   * a low-entropy or HIBP-breached password rejects with
   * `PasswordPolicyError`. Projects that want to skip the breach
   * check (no internet egress) supply only `minEntropyBits`; projects
   * that want full enforcement supply both.
   */
  passwordPolicy?: {
    minEntropyBits?: number;
    breachCheck?: (password: string) => Promise<{ breached: boolean; count?: number }>;
  };
  /**
   * Switch on the magic-link plugin (Better-Auth 1.6 plugin slot 6/9
   * per the PRD). Caller supplies a `sendMagicLink` closure so the
   * email is delivered through the project's `EmailService`. Defaults
   * are otherwise Better-Auth's: 5-minute link expiry, single-use.
   */
  magicLink?: { sendMagicLink: MagicLinkSender };
  /**
   * Switch on the admin plugin (Better-Auth 1.6 plugin slot 4/9).
   * Provides impersonation + ban + role assignment endpoints under
   * `/api/auth/admin/*` for users that hold the `admin` role.
   */
  adminPlugin?: AdminPluginOptions;
  /**
   * Switch on the organization plugin (Better-Auth 1.6 plugin slot
   * 5/9). Provides organization + membership + invitation routes
   * under `/api/auth/organization/*`.
   */
  organization?: OrganizationPluginOptions;
  /**
   * Switch on the one-tap plugin (Better-Auth 1.6 plugin slot 7/9).
   * Backs Google's One Tap chooser; the plugin verifies the ID token
   * Google's UI returns and signs the user in.
   */
  oneTap?: OneTapPluginOptions;
  /**
   * Switch on the OpenAPI plugin (Better-Auth 1.6 plugin slot 8/9).
   * Mounts `/api/auth/reference` (Scalar UI) + the underlying
   * OpenAPI 3.1 document so SDK consumers can introspect the auth
   * surface. The plugin's only side effect is exposing those routes;
   * it does not change auth behaviour.
   */
  openAPI?: OpenAPIPluginOptions;
  /**
   * Per-route rate-limit windows for the auth surface. Wired into
   * Better-Auth's `rateLimit.customRules` map at boot. The shape
   * mirrors `defaultAuthRateLimits()` from `auth/rate-limit.ts`:
   * tighter caps on `/sign-in/email` (credential-stuffing) and
   * `/forget-password` (email-existence leak), looser on
   * `/verify-email` re-sends.
   *
   * The global throttler (`@nestjs/throttler` + `PostgresThrottlerStore`)
   * still protects every route uniformly; these rules add precision
   * for the auth surface where brute-force resistance matters most.
   */
  authRateLimits?: AuthRateLimitsInput;
  /**
   * When `false`, the `authRateLimits` block is not forwarded to
   * Better-Auth even if `authRateLimits` is set. Driven by
   * `BETTER_AUTH_RATE_LIMIT_ENABLED` in `BetterAuthModule`; defaults
   * to `true` so callers that omit this field keep the existing
   * behaviour unchanged.
   */
  rateLimitEnabled?: boolean;
}

export interface AuthRateLimitWindow {
  /** Seconds in the rolling window. */
  readonly windowSeconds: number;
  /** Max requests per window. */
  readonly maxRequests: number;
}

/**
 * Per-route auth rate-limit map. Keys are the Better-Auth route
 * paths under `/api/auth/`. The factory translates this into
 * Better-Auth's `rateLimit.customRules` (a `{path: {window, max}}`
 * object — wildcards like `/sign-in/*` are honoured by the
 * Better-Auth runtime).
 */
export interface AuthRateLimitsInput {
  readonly signIn?: AuthRateLimitWindow;
  readonly signUp?: AuthRateLimitWindow;
  readonly passwordReset?: AuthRateLimitWindow;
  readonly verifyEmail?: AuthRateLimitWindow;
}

/**
 * `sendMagicLink` callback the magic-link plugin invokes when a
 * user requests a sign-in link. The closure is responsible for
 * routing the link through the project's `EmailService` (or the
 * outbox, depending on the email-hooks configuration).
 */
export type MagicLinkSender = (input: {
  readonly email: string;
  readonly token: string;
  readonly url: string;
}) => Promise<void>;

export interface AdminPluginOptions {
  /**
   * The role names that are recognised as administrators. Defaults
   * to `["admin"]`; project code adds entitlement-tier names here
   * (e.g. `["admin", "support"]`).
   */
  adminRoles?: readonly string[];
  /**
   * The role to assign to newly-created users. Defaults to `"user"`.
   */
  defaultRole?: string;
}

export interface OrganizationPluginOptions {
  /**
   * Hard cap on how many organizations a single user can be a member
   * of. Defaults to Better-Auth's built-in (currently 100).
   */
  membershipLimit?: number;
}

export interface OneTapPluginOptions {
  /**
   * Google client id authorised to issue ID tokens for One Tap. The
   * plugin verifies the audience matches this value before signing
   * the user in.
   */
  clientId: string;
}

export interface OpenAPIPluginOptions {
  /**
   * Mount-path for the OpenAPI document and Scalar UI. Defaults to
   * `/reference` (relative to the Better-Auth base path), so the
   * full URL ends up as `/api/auth/reference` under the standard
   * mount.
   */
  path?: string;
  /**
   * When false, only the JSON document is exposed (no Scalar UI).
   * Useful for production where the UI surface is unwanted.
   */
  scalarUI?: boolean;
}

export interface EmailHooksOptions {
  /** `EmailService`-shaped sender — accepts `sendTemplate(args)`. */
  sender: EmailSenderForHooks;
  /** Display name interpolated into subjects + bodies. */
  appName: string;
  /** Optional locale override; defaults to "en" until issue #011 lands. */
  locale?: string;
  /**
   * When true, Better-Auth's email hooks enqueue mails via the
   * email-outbox (issue #11) so a server crash between trigger and
   * SMTP-ACK doesn't lose the verification / reset / welcome mail.
   * Defaults to true — wired by BetterAuthModule when EmailService
   * has the recorder injected.
   */
  useOutbox?: boolean;
  /**
   * Optional throttle for the new-device mail (issue #13). 1 mail
   * per user per hour by default; provided here so the runner can
   * use it.
   */
  newDeviceThrottle?: NewDeviceThrottle;
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

  if (input.emailHooks) {
    if (!input.emailHooks.sender) {
      throw new Error(
        "Better-Auth emailHooks.sender must be a non-null EmailService-shaped object",
      );
    }
    if (!input.emailHooks.appName) {
      throw new Error("Better-Auth emailHooks.appName must be a non-empty string");
    }
  }

  if (input.magicLink && typeof input.magicLink.sendMagicLink !== "function") {
    throw new Error("Better-Auth magicLink.sendMagicLink must be a function");
  }
  if (input.adminPlugin?.adminRoles && input.adminPlugin.adminRoles.length === 0) {
    throw new Error("Better-Auth adminPlugin.adminRoles must be non-empty when provided");
  }
  if (input.oneTap && !input.oneTap.clientId) {
    throw new Error("Better-Auth oneTap.clientId must be a non-empty string");
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
  if (input.magicLink) {
    const send = input.magicLink.sendMagicLink;
    plugins.push(
      magicLink({
        sendMagicLink: async ({ email, token, url }) => {
          await send({ email, token, url });
        },
      }),
    );
  }
  if (input.adminPlugin) {
    plugins.push(
      admin({
        ...(input.adminPlugin.adminRoles ? { adminRoles: [...input.adminPlugin.adminRoles] } : {}),
        ...(input.adminPlugin.defaultRole ? { defaultRole: input.adminPlugin.defaultRole } : {}),
      }),
    );
  }
  if (input.organization) {
    plugins.push(
      organization(
        input.organization.membershipLimit !== undefined
          ? { membershipLimit: input.organization.membershipLimit }
          : {},
      ),
    );
  }
  if (input.oneTap) {
    plugins.push(oneTap({ clientId: input.oneTap.clientId }));
  }
  if (input.openAPI) {
    plugins.push(
      openAPI({
        ...(input.openAPI.path ? { path: input.openAPI.path } : {}),
        ...(input.openAPI.scalarUI === false ? { disableDefaultReference: true } : {}),
      }),
    );
  }

  // Build the email hook runner up front so both `emailVerification` and
  // `emailAndPassword` blocks reference the same configured runner —
  // any future addition (locale resolver, error sink) lands in one place.
  const hookRunner = input.emailHooks
    ? createEmailHookRunner({
        sender: input.emailHooks.sender,
        appName: input.emailHooks.appName,
        ...(input.emailHooks.locale ? { locale: input.emailHooks.locale } : {}),
        // Default to outbox-mode delivery for at-least-once durability
        // (issue #11). Tests / call-sites that want the legacy direct
        // path can opt out by passing `useOutbox: false`.
        useOutbox: input.emailHooks.useOutbox ?? true,
        ...(input.emailHooks.newDeviceThrottle
          ? { newDeviceThrottle: input.emailHooks.newDeviceThrottle }
          : {}),
      })
    : undefined;

  const passwordPolicyInput = input.passwordPolicy;
  // Better-Auth's `password.hash` is the canonical place to gate the
  // policy because it runs on signup AND change-password before the
  // hash is persisted. We delegate to the default scrypt hasher
  // afterwards via `betterAuth`'s own `password` plumbing — the
  // policy is a pre-hash filter, not a hash replacement.
  const emailAndPasswordOptions: NonNullable<BetterAuthOptions["emailAndPassword"]> = {
    enabled: true,
    ...(passwordPolicyInput
      ? {
          password: {
            async hash(password: string): Promise<string> {
              // SDK clients that hash the password locally before
              // transmission send `sha256:<64-char-hex>`. The entropy
              // check would reject a single-class hex digest even though
              // the original password may be arbitrarily strong, so we
              // skip policy validation for this sentinel and hash as-is.
              if (isPreHashedSha256(password)) {
                const { hashPassword } = await import("better-auth/crypto");
                return hashPassword(password);
              }
              const opts: { minEntropyBits?: number } = {};
              if (passwordPolicyInput.minEntropyBits !== undefined) {
                opts.minEntropyBits = passwordPolicyInput.minEntropyBits;
              }
              const breachAdapter = passwordPolicyInput.breachCheck
                ? async (
                    pw: string,
                  ): Promise<
                    | { readonly breached: false }
                    | { readonly breached: true; readonly count: number }
                  > => {
                    const r = await passwordPolicyInput.breachCheck!(pw);
                    return r.breached
                      ? ({ breached: true, count: r.count ?? 0 } as const)
                      : ({ breached: false } as const);
                  }
                : undefined;
              await validatePasswordPolicy(password, opts, breachAdapter);
              // Better-Auth's default scrypt hasher — match the
              // upstream behaviour after the policy gate passes.
              const { hashPassword } = await import("better-auth/crypto");
              return hashPassword(password);
            },
            verify: async ({
              password,
              hash,
            }: {
              password: string;
              hash: string;
            }): Promise<boolean> => {
              const { verifyPassword } = await import("better-auth/crypto");
              return verifyPassword({ password, hash });
            },
          },
        }
      : {}),
    ...(hookRunner
      ? {
          sendResetPassword: async (data: {
            user: { id: string; email: string; name?: string };
            url: string;
            token: string;
          }): Promise<void> => {
            await hookRunner.sendResetPassword({
              user: data.user,
              url: data.url,
              token: data.token,
            });
          },
        }
      : {}),
  };

  const emailVerificationOptions: NonNullable<BetterAuthOptions["emailVerification"]> | undefined =
    hookRunner
      ? {
          sendVerificationEmail: async (data: {
            user: { id: string; email: string; name?: string };
            url: string;
            token: string;
          }): Promise<void> => {
            await hookRunner.sendVerificationEmail({
              user: data.user,
              url: data.url,
              token: data.token,
            });
          },
          // Welcome mail closes the onboarding loop — Better-Auth fires
          // `afterEmailVerification` once the user verifies, which is the
          // last guaranteed touch-point before they're "live".
          afterEmailVerification: async (user: {
            id: string;
            email: string;
            name?: string;
          }): Promise<void> => {
            await hookRunner.sendWelcome({ user });
          },
        }
      : undefined;

  // Device-handling (issue #13). The runner reads the just-created
  // session row, computes a fingerprint, and decides whether to
  // notify the user / revoke an old session. The hook is wired
  // unconditionally when supplied — the runner itself short-circuits
  // when the feature flag is off.
  const deviceRunner = input.deviceHandling?.runner;
  const userCreatedAuditSink = input.userCreatedAudit?.onUserCreated;

  // Build databaseHooks only when at least one hook is supplied.
  // The session and user hooks compose into a single `databaseHooks`
  // object so both fire without overwriting each other.
  const databaseHooks =
    deviceRunner || userCreatedAuditSink
      ? {
          ...(deviceRunner
            ? {
                session: {
                  create: {
                    async after(
                      session: {
                        id: string;
                        userId: string;
                        userAgent?: string | null;
                        ipAddress?: string | null;
                      } & Record<string, unknown>,
                    ): Promise<void> {
                      await deviceRunner.handleSessionCreated({
                        sessionId: session.id,
                        // Better-Auth's session payload doesn't carry the
                        // user's email/name — the runner resolves both via
                        // its injected `userLookup` adapter at email-send
                        // time. We forward only the id here.
                        user: { id: session.userId },
                        userAgent: session.userAgent ?? null,
                        ipAddress: session.ipAddress ?? null,
                      });
                    },
                  },
                },
              }
            : {}),
          ...(userCreatedAuditSink
            ? {
                user: {
                  create: {
                    // Fires after Better-Auth persists the user row. The
                    // hook runs for every creation path (email sign-up,
                    // admin create-user, OAuth first-login, magic-link).
                    // We forward only the fields the audit sink needs —
                    // the sink is responsible for writing the `audit_log`
                    // row via `$executeRaw` (same pattern as the session-
                    // revoke and impersonation sinks).
                    async after(
                      user: {
                        id: string;
                        tenantId?: string | null;
                      } & Record<string, unknown>,
                    ): Promise<void> {
                      await userCreatedAuditSink({
                        id: user.id,
                        tenantId: user.tenantId ?? null,
                      });
                    },
                  },
                },
              }
            : {}),
        }
      : undefined;

  const options: BetterAuthOptions = {
    secret: input.secret,
    baseURL: input.baseUrl,
    basePath,
    emailAndPassword: emailAndPasswordOptions,
    ...(emailVerificationOptions ? { emailVerification: emailVerificationOptions } : {}),
    ...(databaseHooks ? { databaseHooks } : {}),
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
    // `rateLimitEnabled` defaults to true when absent — only suppress the
    // block when the caller has explicitly set it to false (driven by the
    // BETTER_AUTH_RATE_LIMIT_ENABLED env flag in BetterAuthModule).
    ...(input.authRateLimits && input.rateLimitEnabled !== false
      ? {
          rateLimit: {
            // The global rate-limit defaults (window/max) cover every
            // route the customRules don't cite. Better-Auth merges
            // them with its own internal defaults at boot.
            customRules: buildBetterAuthCustomRules(input.authRateLimits),
          },
        }
      : {}),
  };
  return betterAuth(options);
}

/**
 * Translate the project's `AuthRateLimitsInput` into Better-Auth's
 * `rateLimit.customRules` shape: a `{path: {window, max}}` object.
 * Path wildcards (e.g. `/sign-in/*`) are honoured by Better-Auth's
 * matcher at request time.
 */
function buildBetterAuthCustomRules(
  limits: AuthRateLimitsInput,
): Record<string, { window: number; max: number }> {
  const rules: Record<string, { window: number; max: number }> = {};
  if (limits.signIn) {
    rules["/sign-in/*"] = {
      window: limits.signIn.windowSeconds,
      max: limits.signIn.maxRequests,
    };
  }
  if (limits.signUp) {
    rules["/sign-up/*"] = {
      window: limits.signUp.windowSeconds,
      max: limits.signUp.maxRequests,
    };
  }
  if (limits.passwordReset) {
    rules["/forget-password"] = {
      window: limits.passwordReset.windowSeconds,
      max: limits.passwordReset.maxRequests,
    };
    rules["/reset-password"] = {
      window: limits.passwordReset.windowSeconds,
      max: limits.passwordReset.maxRequests,
    };
  }
  if (limits.verifyEmail) {
    rules["/verify-email"] = {
      window: limits.verifyEmail.windowSeconds,
      max: limits.verifyEmail.maxRequests,
    };
    rules["/send-verification-email"] = {
      window: limits.verifyEmail.windowSeconds,
      max: limits.verifyEmail.maxRequests,
    };
  }
  return rules;
}
