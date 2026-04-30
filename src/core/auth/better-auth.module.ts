import { Module } from "@nestjs/common";

import { EmailModule } from "../email/email.module.js";
import { EmailService } from "../email/email.service.js";
import { type Features, loadFeatures } from "../features/features.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import { BetterAuthController } from "./better-auth.controller.js";
import { resolveAppName } from "./better-auth-email-hooks.js";
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from "./better-auth.token.js";
import { type SocialProviderConfig, buildBetterAuth } from "./better-auth.js";

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
  imports: [EmailModule],
  controllers: [BetterAuthController],
  providers: [
    {
      provide: BETTER_AUTH_INSTANCE,
      useFactory: (prisma: PrismaService, email: EmailService): BetterAuthInstance | null => {
        const secret = process.env.BETTER_AUTH_SECRET ?? "";
        if (secret.length < MIN_SECRET_LEN) return null;

        const cfg = serverConfigFromEnv(process.env);
        const env = process.env as Record<string, string | undefined>;
        const features = loadFeatures(env);
        const appName = resolveAppName(env);

        return buildBetterAuth({
          secret,
          baseUrl: cfg.baseUrl,
          sessionExpiresInSeconds: 60 * 60 * 24 * 7,
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
          emailHooks: { sender: email, appName },
          ...(features.authMethods.twoFactor ? { twoFactor: { issuer: "nest-server" } } : {}),
          ...(features.authMethods.passkey ? { passkey: { rpName: "nest-server" } } : {}),
          ...(features.authMethods.socialProviders.length > 0
            ? { socialProviders: pickSocialProviders(features) }
            : {}),
          // PowerSync needs JWT-with-audience + JWKS — Better-Auth's `jwt`
          // plugin auto-exposes `/api/auth/.well-known/jwks` once enabled.
          ...(features.powerSync.enabled ? { jwtPlugin: { audience: "powersync" } } : {}),
        });
      },
      inject: [PrismaService, EmailService],
    },
  ],
  exports: [BETTER_AUTH_INSTANCE],
})
export class BetterAuthModule {}

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
