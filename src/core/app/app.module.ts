import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";

import { ProblemDetailsExceptionFilter } from "../errors/problem-details.filter.js";
import { createLogger } from "../observability/logger.js";
import { serverConfigFromEnv } from "../server/server-config.js";

import { ApiKeyModule } from "../auth/api-keys/api-key.module.js";
import { BetterAuthModule } from "../auth/better-auth.module.js";
import { PowerSyncModule } from "../auth/powersync.module.js";
import { SessionsAdminModule } from "../auth/sessions-admin.module.js";
import { BetterAuthSessionMiddleware } from "../auth/session-middleware.js";
import { ConfigModule } from "../config/config.module.js";
import { DeviceModule } from "../devices/device.module.js";
import { DevHubModule } from "../dx/dev-hub.module.js";
import { EmailModule } from "../email/email.module.js";
import { EmailOutboxModule } from "../email/email-outbox.module.js";
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
import { TenantMemberModule } from "../multi-tenancy/tenant-member.module.js";
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
import { RequestContextMiddleware } from "../request-context/request-context.middleware.js";
import { SystemSetupModule } from "../setup/system-setup.module.js";
import { ExampleModule } from "../../modules/example/example.module.js";
import { UserProfileModule } from "../../modules/user-profile/user-profile.module.js";
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
    // semantics are preserved. autoLogging is disabled in `test` env
    // to keep e2e suites quiet (the SILENT_LOGGER override path is
    // unchanged at the bootstrap layer).
    // In test env the pino-http middleware is skipped — it adds ~10 ms
    // per request via child-logger instantiation which would blow the
    // SC.PERF.02 ≤ 50 ms /health/live median budget. Tests still get
    // the injectable Logger because LoggerModule is imported, but its
    // pinoHttp attaches a no-op `req.log` and skips auto-logging.
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
            autoLogging: isTest
              ? false
              : {
                  ignore: (req) =>
                    !!req.url?.startsWith("/health") ||
                    req.url === "/dev" ||
                    !!req.url?.startsWith("/dev/"),
                },
            quietReqLogger: isTest,
            customLogLevel: (_req, res) => {
              if (res.statusCode >= 500) return "error";
              if (res.statusCode >= 400) return "warn";
              return "debug";
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
    HealthModule,
    DevHubModule,
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
    TenantMemberModule,
    TenantSelfServiceModule,
    ApiKeyModule,
    SessionsAdminModule,
    AdminCrudModule,
    JobsModule,
    OutboxModule,
    // RealtimeModule stays unconditional. SC.BOOT.09's iter-55
    // experiment with `await import()` inside `DevHubModule.forRootAsync`
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
    // `PostgresThrottlerBackend` (iter-77) is wrapped in
    // `PostgresThrottlerStore` and injected via `forRootAsync` so
    // rate-limit windows persist across NestJS instances. The
    // default in-memory storage was vulnerable to sticky-session
    // sharding in horizontally-scaled deployments — the Postgres
    // backend's atomic upsert closes that gap.
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
    FilesModule,
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
    // closes the iter-77 migration's documented promise (the
    // migration shipped the matching `throttler_records_expires_at_idx`
    // index but no cron was wired). 1-day retention buffer keeps
    // recent rate-limit windows for short-term operator debugging.
    ThrottlerCleanupCron,
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: OutputPipelineInterceptor },
    ...(features.multiTenancy.enabled
      ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }]
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
    consumer.apply(AbilityMiddleware).forRoutes("*");
  }
}
