import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";

import { ProblemDetailsExceptionFilter } from "../errors/problem-details.filter.js";
import { createLogger } from "../observability/logger.js";
import { serverConfigFromEnv } from "../server/server-config.js";
import type { AuthenticatedRequest } from "../auth/session-middleware.js";
import { getRequestContext } from "../request-context/request-context.js";

import { ApiKeyModule } from "../auth/api-keys/api-key.module.js";
import { ApiKeySessionMiddleware } from "../auth/api-keys/api-key-session.middleware.js";
import { BetterAuthModule } from "../auth/better-auth.module.js";
import { PowerSyncModule } from "../auth/powersync.module.js";
import { SessionsAdminModule } from "../auth/sessions-admin.module.js";
import { BetterAuthSessionMiddleware } from "../auth/session-middleware.js";
import { ConfigModule } from "../config/config.module.js";
import { DeviceModule } from "../devices/device.module.js";
import { HubSpaModule } from "../dx/hub-spa.module.js";
import { UserAdminModule } from "../dx/user-admin.module.js";
import { HubModule } from "../hub/hub.module.js";
import { HubOperatorTenantInterceptor } from "../hub/hub-operator-tenant.interceptor.js";
import { HubPortalMiddleware } from "../hub/hub-portal.middleware.js";
import { EmailModule } from "../email/email.module.js";
import { EmailOutboxModule } from "../email/email-outbox.module.js";
import { EmailOutboxAdminModule } from "../email/email-outbox-admin.module.js";
import { EncryptionModule } from "../encryption/encryption.module.js";
import { ErrorCodesModule } from "../errors/error-codes.module.js";
import { FilesModule } from "../files/files.module.js";
import { conditionalImport, loadFeatures } from "../features/features.js";
import { GdprModule } from "../gdpr/gdpr.module.js";
import { GeoModule } from "../geo/geo.module.js";
import { GeoIpModule } from "../geoip/geoip.module.js";
import { HealthModule } from "../health/health.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { McpModule } from "../mcp/mcp.module.js";
import { MetricsModule } from "../metrics/metrics.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { WebhooksModule } from "../webhooks/webhooks.module.js";
import { TenantAdminModule } from "../multi-tenancy/tenant-admin.module.js";
import { TenantSelfServiceModule } from "../multi-tenancy/tenant-self-service.module.js";
import { TenantInterceptor } from "../multi-tenancy/tenant.interceptor.js";
import { OutputPipelineInterceptor } from "../output-pipeline/output-pipeline.interceptor.js";
import { AbilityMiddleware } from "../permissions/ability.middleware.js";
import { AdminCrudModule } from "../permissions/admin-crud.module.js";
import { FiltersModule } from "../permissions/filters.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { SearchModule } from "../search/search.module.js";
import { PostgresThrottlerStore } from "../throttler/throttler.js";
import { ThrottlerCleanupCron } from "../throttler/throttler-cleanup.js";
import { PostgresThrottlerBackend } from "../throttler/throttler-postgres-backend.js";
import { RateLimitAdminModule } from "../throttler/rate-limit-admin.module.js";
import { RequestContextMiddleware } from "../request-context/request-context.middleware.js";
import { SystemSetupModule } from "../setup/system-setup.module.js";
import { ExampleModule } from "../../modules/example/example.module.js";
import { UserProfileModule } from "../../modules/user-profile/user-profile.module.js";
import { RedisModule } from "../redis/redis.module.js";
import { AppController } from "./app.controller.js";

const features = loadFeatures(process.env as Record<string, string | undefined>);

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
    // Iter-206 CF.OBS closure: nestjs-pino LoggerModule provides the
    // HTTP-request-level logging interceptor + injectable `Logger`
    // throughout the app. The underlying Pino instance comes from
    // `createLogger()` so dev-pretty + log-buffer + sink-stream
    // semantics are preserved. pino-http `autoLogging` stays off so the
    // console is not flooded with per-request "request completed" lines;
    // correlation still flows through RequestContextMiddleware + manual
    // `Logger` calls. In `test` env the injectable logger is `silent`.
    LoggerModule.forRootAsync({
      useFactory: () => {
        const cfg = serverConfigFromEnv(process.env);
        const isTest = process.env.NODE_ENV === "test";
        const pinoLogger = createLogger({
          env: cfg.env,
          name: "nest-server",
          ...(isTest ? { level: "silent" as const } : {}),
        });
        return {
          pinoHttp: {
            logger: pinoLogger,
            autoLogging: false,
            quietReqLogger: true,
            // Available on manual `req.log` calls — not emitted unless
            // application code logs explicitly.
            customProps: (req) => {
              const user = (req as AuthenticatedRequest).user;
              const headerRequestId = req.headers["x-request-id"];
              const requestId =
                getRequestContext()?.requestId ??
                (typeof headerRequestId === "string"
                  ? headerRequestId
                  : Array.isArray(headerRequestId)
                    ? headerRequestId[0]
                    : undefined);
              return {
                ...(requestId ? { requestId } : {}),
                ...(user?.id ? { userId: user.id } : {}),
                ...(user?.activeOrganizationId ? { tenantId: user.activeOrganizationId } : {}),
              };
            },
            // Skip the per-request `req.id` generation in tests — pino-http
            // calls genReqId on every request which adds measurable
            // overhead under the /health/live tight loop.
            ...(isTest ? { genReqId: () => "" } : {}),
          },
        };
      },
    }),
    PrismaModule,
    // RedisModule provides the shared ioredis connection (or null when
    // REDIS_URL is not set) under the REDIS_CLIENT token. @Global() so
    // every module can inject it without importing RedisModule individually.
    RedisModule,
    HealthModule,
    // HubModule — CASL gate for `/hub/*` + `/admin/*` (Better-Auth session).
    HubModule,
    HubSpaModule,
    BetterAuthModule,
    ErrorCodesModule,
    PermissionsModule,
    FiltersModule,
    SystemSetupModule,
    // Feature-gated modules: each landing only when its flag in
    // `features.ts` is on. Skipping the module-level import is what
    // delivers the heap-budget delta the PRD's `SC.BOOT.09` requires
    // — provider-level guards inside an always-loaded module would
    // still cost the parse + decorator-metadata + DI-graph footprint.
    // Cross-feature consumers (e.g. `AdminSpaController` for
    // `RealtimeGateway`, `BetterAuthModule` + `DeviceHandlingRunner`
    // for `GeoIpService`) inject the corresponding token with
    // `@Optional()` so DI doesn't blow up when the module isn't loaded.
    ...conditionalImport(features, "search", SearchModule),
    GdprModule,
    ...conditionalImport(features, "geo", GeoModule),
    GeoIpModule,
    ...conditionalImport(features, "deviceManagement", DeviceModule),
    ...conditionalImport(features, "powerSync", PowerSyncModule),
    IdempotencyModule,
    // EmailOutboxModule must come BEFORE EmailModule so the
    // EMAIL_OUTBOX_RECORDER token is registered before EmailModule's
    // factory runs (it picks the recorder up via optional inject).
    EmailOutboxModule,
    EmailModule,
    // Admin surface for email-outbox operator actions (issue #91).
    EmailOutboxAdminModule,
    ...conditionalImport(features, "multiTenancy", TenantSelfServiceModule),
    ...conditionalImport(features, "multiTenancy", TenantAdminModule),
    ApiKeyModule,
    SessionsAdminModule,
    UserAdminModule,
    AdminCrudModule,
    JobsModule,
    OutboxModule,
    // RealtimeModule stays unconditional. SC.BOOT.09's iter-55
    // experiment with `await import()` inside `HubSpaModule.forRootAsync`
    // succeeded structurally (3188/3188 e2e green) but did NOT increase
    // the measured heap delta beyond the iter-53 5.01 MB ceiling — the
    // dynamic-import overhead absorbed the saved socket.io cost in
    // practice. Reverted to keep the test suite stable.
    RealtimeModule,
    ...conditionalImport(features, "webhooks", WebhooksModule),
    ...conditionalImport(features, "mcp", McpModule),
    // MetricsModule mounts `GET /metrics` (Prometheus text-format) when
    // `features.observability.enabled` is on. Default-on; consumers
    // running offline / without scrapers opt out via
    // FEATURE_OBSERVABILITY_ENABLED=false.
    ...conditionalImport(features, "observability", MetricsModule),
    // Throttler with multi-window defaults: short burst (10s/100req) +
    // sustained (1m/300req) + per-day cap. The Postgres-backed
    // Rate limiting is gated behind the `rateLimit` feature flag so
    // local development / test environments can opt out of the Postgres
    // throttle store without schema migrations. ThrottlerModule,
    // RateLimitAdminModule, ThrottlerCleanupCron, and the ThrottlerGuard
    // APP_GUARD are all conditional on the same flag.
    ...(features.rateLimit.enabled
      ? [
          ThrottlerModule.forRootAsync({
            inject: [PrismaService],
            useFactory: (prisma: PrismaService) => ({
              throttlers: [
                { name: "short", ttl: 10_000, limit: 100 },
                { name: "sustained", ttl: 60_000, limit: 300 },
                { name: "daily", ttl: 24 * 60 * 60 * 1000, limit: 100_000 },
              ],
              storage: new PostgresThrottlerStore(new PostgresThrottlerBackend(prisma)),
            }),
          }),
        ]
      : []),
    FilesModule,
    // Rate-limit admin: /admin/rate-limits inspector, config editor,
    // decision history, key reset, and allowlist management (issue #94).
    ...(features.rateLimit.enabled ? [RateLimitAdminModule] : []),
    ...conditionalImport(features, "fieldEncryption", EncryptionModule.forRoot()),
    // Example project-owned module — copy this folder + the test file
    // to scaffold a new resource. Drop the import once you have your
    // own modules. Or use `/add-module <name>` for the guided path.
    ExampleModule,
    // UserProfile reference — the "extend the framework-managed User
    // with project-specific fields" pattern. Drop alongside Example
    // once you've internalised the structure.
    UserProfileModule,
  ],
  controllers: [AppController],
  providers: [
    RequestContextMiddleware,
    BetterAuthSessionMiddleware,
    // Iter-198: hourly cleanup of stale `throttler_records` rows —
    // only wired when rate limiting is enabled so the cleanup job
    // doesn't attempt DB operations against a non-existent table.
    ...(features.rateLimit.enabled ? [ThrottlerCleanupCron] : []),
    // RFC 7807 Problem-Details exception filter — registered via
    // APP_FILTER so it activates for BOTH the production
    // `bootstrap()` chain AND tests booted through
    // `Test.createTestingModule({ imports: [AppModule] })
    //   .createNestApplication()`. Previously the filter was only
    // attached imperatively in `bootstrap.ts` via
    // `app.useGlobalFilters(...)`, which the testing module skips —
    // so a `ZodError` raised inside a handler returned 500 instead
    // of 400 + CORE_VALIDATION (friction-log 2026-05-03).
    { provide: APP_FILTER, useClass: ProblemDetailsExceptionFilter },
    ...(features.rateLimit.enabled ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }] : []),
    { provide: APP_INTERCEPTOR, useClass: OutputPipelineInterceptor },
    ...(features.multiTenancy.enabled
      ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }]
      : []),
    // Single-tenant deployments never mount `TenantInterceptor` above, so
    // core Hub/admin routes (`requireTenantContext()`) would have no tenant
    // in the ALS → 400. This Hub-scoped interceptor resolves the operator's
    // OWN membership tenant for `/hub/*` + `/admin/*` only; all other paths
    // (the product `/api/*` surface, which pins its own tenant) pass through
    // untouched. Mutually exclusive with `TenantInterceptor` by the flag.
    ...(!features.multiTenancy.enabled
      ? [{ provide: APP_INTERCEPTOR, useClass: HubOperatorTenantInterceptor }]
      : []),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order matters and is observable to every downstream guard:
    //   1. RequestContext  — request id / trace id / tenant context
    //                        populate the AsyncLocalStorage.
    //   2. Session         — Better-Auth resolves `req.user` from the
    //                        session cookie / Authorization header.
    //   3. Ability         — `req.ability` is built from the user's
    //                        rules. NestJS runs middleware BEFORE
    //                        guards, so `CanGuard` always sees a
    //                        populated ability. The `TestAbilityMiddleware`
    //                        registered inside `PermissionsModule` runs
    //                        first across the chain and lets specs
    //                        pre-seed the ability via `X-Test-Ability`
    //                        — this middleware honours that and
    //                        short-circuits when the ability is already
    //                        set.
    consumer.apply(RequestContextMiddleware).forRoutes("*");
    consumer.apply(BetterAuthSessionMiddleware).forRoutes("*");
    consumer.apply(ApiKeySessionMiddleware).forRoutes("*");
    consumer.apply(AbilityMiddleware).forRoutes("*");
    consumer.apply(HubPortalMiddleware).forRoutes("*");
  }
}
