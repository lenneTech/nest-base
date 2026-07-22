import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { JobsModule } from "../jobs/jobs.module.js";
import { DevFilesController } from "./dev-files.controller.js";
import { HubController } from "./hub.controller.js";
import { MigrationsService } from "./migrations/migrations.service.js";
import { RouteInventoryService } from "./route-inventory-runner.js";

/**
 * HubSpaModule — registers the `/hub` SPA controllers.
 *
 * Loaded unconditionally; every route short-circuits through the
 * tiered surface guard (`hub-surface-policy.ts`): outside
 * `NODE_ENV=development` operational surfaces 404 unless
 * `FEATURE_HUB_ENABLED=true` (plus the CASL wall in
 * `HubPortalMiddleware`), and workstation surfaces 404 always — tool
 * URLs can never leak from a deployment that didn't opt in.
 *
 * REGISTRATION ORDER: this module is imported LAST among the portal
 * modules in `AppModule` because `HubController` owns the
 * `GET /hub/*splat` SPA-shell catch-all and Express matches routes in
 * registration order — every `/hub/admin/*` controller (user/tenant/
 * sessions/email-outbox admin, admin CRUD, rate limits, and the
 * `HubAdminSpaModule` inspectors) must register before it. Within this
 * module `DevFilesController` registers before `HubController` so its
 * specific `/hub/files/*.json` routes win over the catch-all.
 *
 * `DiscoveryModule` is imported so `RouteInventoryService` can walk
 * the registered controllers for `/hub/routes`. `MigrationsService` is
 * a dev-only orchestrator for the `/hub/migrations` page; it depends on
 * the global `PrismaService` for advisory locks + `_prisma_migrations`
 * reads. `JobsModule` is imported so the controller can read the
 * in-memory queue history for the `/hub/jobs/*` dashboard.
 */
@Module({
  imports: [DiscoveryModule, JobsModule],
  controllers: [DevFilesController, HubController],
  providers: [RouteInventoryService, MigrationsService],
  exports: [RouteInventoryService],
})
export class HubSpaModule {}
