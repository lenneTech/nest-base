import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { AuditLogModule } from "../audit/audit-log.module.js";
import { ApiKeyModule } from "../auth/api-keys/api-key.module.js";
import { BetterAuthModule } from "../auth/better-auth.module.js";
import { PowerSyncModule } from "../auth/powersync.module.js";
import { ConfigModule } from "../config/config.module.js";
import { DevHubModule } from "../dx/dev-hub.module.js";
import { EmailModule } from "../email/email.module.js";
import { EncryptionModule } from "../encryption/encryption.module.js";
import { ErrorCodesModule } from "../errors/error-codes.module.js";
import { FilesModule } from "../files/files.module.js";
import { conditionalImport, loadFeatures } from "../features/features.js";
import { GdprModule } from "../gdpr/gdpr.module.js";
import { GeoModule } from "../geo/geo.module.js";
import { HealthModule } from "../health/health.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { McpModule } from "../mcp/mcp.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";
import { WebhooksModule } from "../webhooks/webhooks.module.js";
import { TenantMemberModule } from "../multi-tenancy/tenant-member.module.js";
import { TenantInterceptor } from "../multi-tenancy/tenant.interceptor.js";
import { OutputPipelineInterceptor } from "../output-pipeline/output-pipeline.interceptor.js";
import { AdminCrudModule } from "../permissions/admin-crud.module.js";
import { FiltersModule } from "../permissions/filters.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { SearchModule } from "../search/search.module.js";
import { RequestContextMiddleware } from "../request-context/request-context.middleware.js";
import { SystemSetupModule } from "../setup/system-setup.module.js";
import { ExampleModule } from "../../modules/example/example.module.js";
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
    IdempotencyModule,
    EmailModule,
    AuditLogModule,
    TenantMemberModule,
    ApiKeyModule,
    AdminCrudModule,
    JobsModule,
    OutboxModule,
    RealtimeModule,
    WebhooksModule,
    McpModule,
    // Throttler with multi-window defaults: short burst (10s/100req) +
    // sustained (1m/300req) + per-day cap. Postgres-backed store
    // adapter swaps in once the throttler-records table is migrated;
    // until then NestJS' default in-memory storage is used.
    ThrottlerModule.forRoot([
      { name: "short", ttl: 10_000, limit: 100 },
      { name: "sustained", ttl: 60_000, limit: 300 },
      { name: "daily", ttl: 24 * 60 * 60 * 1000, limit: 100_000 },
    ]),
    FilesModule,
    ...conditionalImport(features, "fieldEncryption", EncryptionModule.forRoot()),
    // Example project-owned module — copy this folder + the test file
    // to scaffold a new resource. Drop the import once you have your
    // own modules. Or use `/add-module <name>` for the guided path.
    ExampleModule,
  ],
  controllers: [AppController],
  providers: [
    RequestContextMiddleware,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: OutputPipelineInterceptor },
    ...(features.multiTenancy.enabled
      ? [{ provide: APP_INTERCEPTOR, useClass: TenantInterceptor }]
      : []),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes("*");
  }
}
