import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DevtoolsModule } from '@nestjs/devtools-integration';

import { BetterAuthModule } from '../auth/better-auth.module.js';
import { PowerSyncModule } from '../auth/powersync.module.js';
import { ConfigModule } from '../config/config.module.js';
import { buildDevToolsConfig, type DevToolsEnv } from '../dx/devtools-config.js';
import { DevHubModule } from '../dx/dev-hub.module.js';
import { EncryptionModule } from '../encryption/encryption.module.js';
import { ErrorCodesModule } from '../errors/error-codes.module.js';
import { conditionalImport, loadFeatures } from '../features/features.js';
import { GdprModule } from '../gdpr/gdpr.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { HealthModule } from '../health/health.module.js';
import { TenantInterceptor } from '../multi-tenancy/tenant.interceptor.js';
import { OutputPipelineInterceptor } from '../output-pipeline/output-pipeline.interceptor.js';
import { FiltersModule } from '../permissions/filters.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SearchModule } from '../search/search.module.js';
import { RequestContextMiddleware } from '../request-context/request-context.middleware.js';
import { SystemSetupModule } from '../setup/system-setup.module.js';
import { AppController } from './app.controller.js';

const features = loadFeatures(process.env as Record<string, string | undefined>);
const devtoolsEnv: DevToolsEnv =
  process.env.NODE_ENV === 'production'
    ? 'production'
    : process.env.NODE_ENV === 'test'
      ? 'test'
      : 'development';
// Opt-in via env-var so the default boot doesn't bind port 8000 in
// every test process. Set `NESTJS_DEVTOOLS=1` to flip on the
// snapshot UI in `bun run dev`.
const devtoolsExplicit = process.env.NESTJS_DEVTOOLS === '1';
const devtools = buildDevToolsConfig({
  env: devtoolsEnv,
  enabled: devtoolsExplicit,
  http: devtoolsExplicit,
});

/**
 * Root module of the NestJS application.
 *
 * Subsequent slices register their feature modules here (Auth, Permissions,
 * Files, Realtime, …) — all behind feature flags so consumers only pull
 * in what they enabled in `features.ts`.
 *
 * `RequestContextMiddleware` runs first on every route so the
 * AsyncLocalStorage context (request id, trace id, tenant) is populated
 * before any controller, guard, or interceptor executes.
 *
 * `OutputPipelineInterceptor` runs on every controller response and
 * strips known-secret-shaped fields (Stages 3+4 of the four-stage
 * Output-Pipeline). The remaining stages (record-level permission
 * filter + field allowlist) activate once an `Ability` is resolvable
 * per request.
 */
@Module({
  imports: [
    ConfigModule.forRoot(),
    PrismaModule,
    HealthModule,
    DevHubModule,
    BetterAuthModule,
    ErrorCodesModule,
    PermissionsModule,
    FiltersModule,
    SystemSetupModule,
    // SearchModule is loaded unconditionally — empty executor list
    // by default, projects opt in via SEARCH_EXECUTORS multi-provider.
    SearchModule,
    GdprModule,
    GeoModule,
    PowerSyncModule,
    ...conditionalImport(features, 'fieldEncryption', EncryptionModule.forRoot()),
    ...(devtools.enabled && devtools.http
      ? [DevtoolsModule.register({ http: true, port: devtools.port })]
      : []),
  ],
  controllers: [AppController],
  providers: [
    RequestContextMiddleware,
    { provide: APP_INTERCEPTOR, useClass: OutputPipelineInterceptor },
    ...(features.multiTenancy.enabled
      ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }]
      : []),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
