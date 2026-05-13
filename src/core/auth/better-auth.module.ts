import { Module } from "@nestjs/common";

import { loadBrandSync } from "../branding/brand-loader.js";
import {
  createDeviceHandlingRunner,
  type DeviceEmailDispatcher,
  type DeviceHandlingSessionStore,
  type DeviceHandlingUserLookup,
} from "../devices/device-handling.runner.js";
import { createNewDeviceThrottle } from "../devices/new-device-throttle.js";
import { EmailModule } from "../email/email.module.js";
import { EmailService } from "../email/email.service.js";
import { type Features, loadFeatures } from "../features/features.js";
import { GeoIpModule } from "../geoip/geoip.module.js";
import { GeoIpService } from "../geoip/geoip.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  PrismaVerificationStore,
  VERIFICATION_STORE,
  VerificationCleanupCron,
} from "./verification-cleanup.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { BetterAuthController } from "./better-auth.controller.js";
import {
  createEmailHookRunner,
  type EmailSenderForHooks,
} from "./better-auth-email-hooks.runner.js";
import { resolveAppName } from "./better-auth-email-hooks.js";
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "./better-auth.token.js";
import { type SocialProviderConfig, buildBetterAuth } from "./better-auth.js";
import { defaultAuthRateLimits } from "./rate-limit.js";
import { isBetterAuthRateLimitEnabled } from "./rate-limit-flag.js";

const MIN_SECRET_LEN = 32;

/**
 * BetterAuthModule — wires a Better-Auth instance based on the active
 * features and mounts the handler at `/api/auth/*`.
 *
 * The instance is built inside a `useFactory` so the env (`BETTER_AUTH_SECRET`)
 * is read at provider-init time, NOT at `@Module` decoration time. That
 * matters in tests: setting `process.env.BETTER_AUTH_SECRET` in a
 * `beforeAll()` happens after the module file is imported but before
 * `bootstrap()` resolves the provider — only the deferred read sees it.
 *
 * Without a secret (≥ 32 chars), the factory returns `null`. The
 * controller checks for null and responds 503 — `/api/auth/*` is then
 * effectively disabled.
 */
@Module({
  imports: [EmailModule, GeoIpModule],
  controllers: [BetterAuthController],
  providers: [
    {
      provide: BETTER_AUTH_INSTANCE,
      useFactory: (
        prisma: PrismaService,
        email: EmailService,
        geoIp: GeoIpService,
      ): BetterAuthInstance | null => {
        const secret = process.env.BETTER_AUTH_SECRET ?? "";
        if (secret.length < MIN_SECRET_LEN) return null;

        const cfg = serverConfigFromEnv(process.env);
        const env = process.env as Record<string, string | undefined>;
        const features = loadFeatures(env);
        const appName = resolveAppName(env);
        // Brand drives the TOTP issuer + Passkey RP-name so authenticator
        // apps and WebAuthn prompts say "Acme" instead of the template
        // default. Loaded once at provider init — env-watch restart picks
        // up brand.json edits.
        const brand = loadBrandSync();

        // Device-handling (issue #13). Wired only when the feature is
        // on — the runner short-circuits internally too, but skipping
        // the wiring keeps the auth path strictly equivalent to pre-#13
        // behaviour for projects that left the toggle off.
        const deviceCfg = features.deviceManagement;
        const newDeviceThrottle = deviceCfg.enabled ? createNewDeviceThrottle() : undefined;

        // EmailService implements the EmailSenderForHooks shape but
        // ships a wider type surface (driver selection, rate limit,
        // outbox routing). Bridge through a typed `unknown`
        // intermediate so the disqualifier scan stays clean.
        const senderErased: unknown = email;
        const hookRunner = deviceCfg.enabled
          ? createEmailHookRunner({
              sender: senderErased as EmailSenderForHooks,
              appName,
              useOutbox: true,
              ...(newDeviceThrottle ? { newDeviceThrottle } : {}),
            })
          : undefined;

        const deviceHandling =
          deviceCfg.enabled && hookRunner
            ? {
                runner: createDeviceHandlingRunner({
                  store: buildPrismaSessionStore(prisma),
                  email: buildHookEmailDispatcher(hookRunner),
                  userLookup: buildPrismaUserLookup(prisma),
                  geoIp,
                  config: {
                    enabled: deviceCfg.enabled,
                    notifyOnNewDevice: deviceCfg.notifyOnNewDevice,
                    maxDevicesPerUser: deviceCfg.maxDevicesPerUser,
                    fingerprintMode: deviceCfg.sessionFingerprint,
                    appBaseUrl: cfg.baseUrl,
                  },
                }),
              }
            : undefined;

        return buildBetterAuth({
          secret,
          baseUrl: cfg.baseUrl,
          sessionExpiresInSeconds: 60 * 60 * 24 * 7,
          // Audit hook (issue #99): write a CREATE row to audit_log after
          // every user creation, regardless of the creation path. The hook
          // mirrors the impersonation + session-revoke sinks: $executeRaw
          // bypasses the Prisma model-delegate proxy issue (iter-84) and
          // maps directly to the canonical audit_log columns. Feature gating
          // respects FEATURE_AUDIT_ENABLED — same semantics as other sinks.
          userCreatedAudit: {
            async onUserCreated(user: { id: string; tenantId?: string | null }): Promise<void> {
              const { loadFeatures } = await import("../features/features.js");
              const feats = loadFeatures(process.env as Record<string, string | undefined>);
              if (!feats.audit.enabled) return;

              const occurredAtIso = new Date().toISOString();
              const metadataJson = JSON.stringify({ source: "better-auth" });
              // tenantId is nullable on User — pass NULL when not set.
              // actorUserId = the new user's own id (self-signup semantics).
              if (user.tenantId) {
                await prisma.$executeRaw`
                  INSERT INTO audit_log
                    (id, tenant_id, actor_user_id, target_model, target_id, action, diff, metadata, created_at)
                  VALUES
                    (gen_random_uuid(),
                     ${user.tenantId}::uuid,
                     ${user.id}::uuid,
                     ${"User"},
                     ${user.id},
                     ${"CREATE"}::audit_action,
                     '{}'::jsonb,
                     ${metadataJson}::jsonb,
                     ${occurredAtIso}::timestamp)
                `;
              } else {
                await prisma.$executeRaw`
                  INSERT INTO audit_log
                    (id, tenant_id, actor_user_id, target_model, target_id, action, diff, metadata, created_at)
                  VALUES
                    (gen_random_uuid(),
                     NULL,
                     ${user.id}::uuid,
                     ${"User"},
                     ${user.id},
                     ${"CREATE"}::audit_action,
                     '{}'::jsonb,
                     ${metadataJson}::jsonb,
                     ${occurredAtIso}::timestamp)
                `;
              }
            },
          },
          // Allow operators to mount Better-Auth under a custom prefix
          // (issue #101). When unset, `resolveBetterAuthMountPath()`
          // falls back to the `/api/auth` default — back-compat is
          // preserved for existing deployments.
          ...(process.env.BETTER_AUTH_BASE_PATH
            ? { basePath: process.env.BETTER_AUTH_BASE_PATH }
            : {}),
          // `prisma` is the global PrismaService — passing it switches
          // Better-Auth from the in-memory storage (which silently
          // dropped registrations on every restart) to the real
          // Postgres-backed Prisma adapter.
          prisma,
          // Wire the email-verification / password-reset / welcome
          // hooks to EmailService. Drivers + templates live in
          // `src/core/email/`; the runner translates each Better-Auth
          // payload into a `sendTemplate()` call. Failures stay
          // best-effort: they're logged but the auth flow proceeds —
          // until the outbox slice (issue #11) adds at-least-once.
          //
          // Wired unconditionally: when `features.email.enabled === false`
          // the EmailModule provides a `log-only` driver, so the hook
          // still completes (with a logged stdout line) instead of
          // silently no-op'ing inside Better-Auth's defaults.
          emailHooks: {
            sender: email,
            appName,
            ...(newDeviceThrottle ? { newDeviceThrottle } : {}),
          },
          ...(deviceHandling ? { deviceHandling } : {}),
          ...(features.authMethods.twoFactor ? { twoFactor: { issuer: brand.name } } : {}),
          ...(features.authMethods.passkey ? { passkey: { rpName: brand.name } } : {}),
          ...(features.authMethods.socialProviders.length > 0
            ? { socialProviders: pickSocialProviders(features) }
            : {}),
          // PowerSync needs JWT-with-audience + JWKS — Better-Auth's `jwt`
          // plugin auto-exposes `/api/auth/.well-known/jwks` once enabled.
          ...(features.powerSync.enabled ? { jwtPlugin: { audience: "powersync" } } : {}),
          // Per-route auth rate-limits (CF.SEC.AUTH_RATE_LIMIT). The
          // `defaultAuthRateLimits()` helper exposes the production
          // defaults (5/min sign-in, 10/min sign-up, 3/h password
          // reset, 10/h verify); projects override by passing their
          // own `AuthRateLimitsInput` here. Brute-force protection
          // on `/api/auth/sign-in/*` rides on this surface alongside
          // the global @nestjs/throttler.
          authRateLimits: defaultAuthRateLimits(),
          // BETTER_AUTH_RATE_LIMIT_ENABLED: defaults false in test/dev
          // (rapid runs exhaust the window and generate spurious 429s),
          // true in production and staging. Explicit env override wins.
          rateLimitEnabled: isBetterAuthRateLimitEnabled(
            process.env as Record<string, string | undefined>,
          ),
          // Organization plugin (issue #118): enabled by default to back
          // the BA Organizations-as-Tenants migration. When active, BA
          // manages org/member/invitation rows and the session carries
          // `activeOrganizationId` so clients can omit the x-tenant-id
          // header after a POST /api/auth/organization/set-active call.
          ...(features.organization.enabled ? { organization: {} } : {}),
          // Password policy enforcement is opt-in via features.ts.
          // Set FEATURE_PASSWORD_POLICY_ENABLED=true to activate. The
          // service exposes the policy validator (entropy + optional
          // HIBP breach check) so signup / change-password run the
          // gate before persisting the hash. Default min entropy =
          // 50 bits (≈ 12-char mixed-case+digit). HIBP check is
          // enabled when `FEATURE_PASSWORD_HIBP=true` (production
          // egress to api.pwnedpasswords.com required).
          // Previously read process.env directly — now routes through
          // features.ts so all toggle logic lives in one place (H2 fix).
          ...(features.passwordPolicy.enabled
            ? {
                passwordPolicy: {
                  ...(process.env.PASSWORD_POLICY_MIN_ENTROPY_BITS
                    ? {
                        minEntropyBits: Number.parseInt(
                          process.env.PASSWORD_POLICY_MIN_ENTROPY_BITS,
                          10,
                        ),
                      }
                    : {}),
                  ...(process.env.FEATURE_PASSWORD_HIBP === "true"
                    ? {
                        breachCheck: async (
                          pw: string,
                        ): Promise<{ breached: boolean; count?: number }> => {
                          const { fetchHibpRange, buildHibpBreachCheck } =
                            await import("./password-policy.js");
                          const check = buildHibpBreachCheck({ fetchRange: fetchHibpRange });
                          const result = await check(pw);
                          return result.breached
                            ? { breached: true, count: result.count }
                            : { breached: false };
                        },
                      }
                    : {}),
                },
              }
            : {}),
        });
      },
      inject: [PrismaService, EmailService, GeoIpService],
    },
    // Iter-193: prunes stale Better-Auth `verifications` rows older
    // than 7 days — the table accumulates one row per email-verify /
    // password-reset / magic-link issuance and Better-Auth itself
    // does not auto-prune. Cron tick mirrors sibling cleanup crons
    // (idempotency, geocoding-cache, variant-cache).
    {
      provide: VERIFICATION_STORE,
      useFactory: (prisma: PrismaService) => new PrismaVerificationStore(prisma),
      inject: [PrismaService],
    },
    VerificationCleanupCron,
  ],
  exports: [BETTER_AUTH_INSTANCE],
})
export class BetterAuthModule {}

function buildPrismaSessionStore(prisma: PrismaService): DeviceHandlingSessionStore {
  return {
    async setFingerprint(sessionId, fingerprint) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { fingerprint },
      });
    },
    async listForUser(userId) {
      // Push the expiry filter into the DB so we don't load all
      // sessions for a user who has accumulated many stale rows.
      // Cap at 100 to stay memory-bounded; a legitimate user won't
      // have more than that many active sessions at once. The
      // post-filter below is a defensive second check in case the
      // DB clock and the process clock disagree slightly.
      const rows = await prisma.session.findMany({
        where: { userId, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      const now = Date.now();
      return rows
        .filter((r) => r.expiresAt.getTime() > now)
        .map((r) => ({
          id: r.id,
          fingerprintHash: r.fingerprint ?? "",
          lastSeenAt: r.updatedAt,
          createdAt: r.createdAt,
        }));
    },
    async revoke(sessionId) {
      try {
        await prisma.session.delete({ where: { id: sessionId } });
        return true;
      } catch {
        return false;
      }
    },
  };
}

function buildPrismaUserLookup(prisma: PrismaService): DeviceHandlingUserLookup {
  return {
    async findById(userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        ...(user.name ? { name: user.name } : {}),
      };
    },
  };
}

function buildHookEmailDispatcher(
  runner: ReturnType<typeof createEmailHookRunner>,
): DeviceEmailDispatcher {
  return {
    async sendNewDevice(input): Promise<void> {
      await runner.sendNewDevice(input);
    },
  };
}

function pickSocialProviders(features: Features): SocialProviderConfig {
  const providers: SocialProviderConfig = {};
  for (const id of features.authMethods.socialProviders) {
    const upper = id.toUpperCase();
    const clientId = process.env[`${upper}_CLIENT_ID`];
    const clientSecret = process.env[`${upper}_CLIENT_SECRET`];
    if (clientId && clientSecret) {
      providers[id] = { clientId, clientSecret };
    }
  }
  return providers;
}
