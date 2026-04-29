import { Module } from '@nestjs/common';

import { type Features, loadFeatures } from '../features/features.js';
import { serverConfigFromEnv } from '../server/server-config.js';
import { BetterAuthController } from './better-auth.controller.js';
import { BETTER_AUTH_INSTANCE, type BetterAuthInstance } from './better-auth.token.js';
import { type SocialProviderConfig, buildBetterAuth } from './better-auth.js';

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
  controllers: [BetterAuthController],
  providers: [
    {
      provide: BETTER_AUTH_INSTANCE,
      useFactory: (): BetterAuthInstance | null => {
        const secret = process.env.BETTER_AUTH_SECRET ?? '';
        if (secret.length < MIN_SECRET_LEN) return null;

        const cfg = serverConfigFromEnv(process.env);
        const features = loadFeatures(process.env as Record<string, string | undefined>);

        return buildBetterAuth({
          secret,
          baseUrl: cfg.baseUrl,
          sessionExpiresInSeconds: 60 * 60 * 24 * 7,
          ...(features.authMethods.twoFactor ? { twoFactor: { issuer: 'nest-server' } } : {}),
          ...(features.authMethods.passkey ? { passkey: { rpName: 'nest-server' } } : {}),
          ...(features.authMethods.socialProviders.length > 0
            ? { socialProviders: pickSocialProviders(features) }
            : {}),
        });
      },
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
