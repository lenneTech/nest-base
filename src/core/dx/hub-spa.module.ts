import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { JobsModule } from "../jobs/jobs.module.js";
import { AdminSpaController } from "./admin-spa.controller.js";
import { DevFilesController } from "./dev-files.controller.js";
import { HubController } from "./hub.controller.js";
import { MigrationsService } from "./migrations/migrations.service.js";
import { RouteInventoryService } from "./route-inventory-runner.js";
import { RealtimeModule } from "../realtime/realtime.module.js";

/**
 * HubSpaModule — registers the `/hub` and `/admin` SPA controllers.
 *
 * Loaded unconditionally; both controllers short-circuit to a 404
 * outside `NODE_ENV=development` so they can never leak tool URLs in
 * production.
 *
 * `DiscoveryModule` is imported so `RouteInventoryService` can walk
 * the registered controllers for `/hub/routes`. `MigrationsService` is
 * a dev-only orchestrator for the `/hub/migrations` page; it depends on
 * the global `PrismaService` for advisory locks + `_prisma_migrations`
 * reads. `JobsModule` is imported so the controller can read the
 * in-memory queue history for the `/hub/jobs/*` dashboard.
 * `RealtimeModule` is imported so the AdminSpa controller can read
 * the inspector snapshot and drive the disconnect / send / replay
 * actions.
 */
@Module({
  imports: [DiscoveryModule, JobsModule, RealtimeModule],
  // Order matters: `DevFilesController` registers before `HubController`
  // so its specific `/hub/files/*.json` routes win over the latter's
  // `@Get('*splat')` SPA-shell catch-all.
  controllers: [DevFilesController, AdminSpaController, HubController],
  providers: [RouteInventoryService, MigrationsService],
  exports: [RouteInventoryService],
})
export class HubSpaModule {}
