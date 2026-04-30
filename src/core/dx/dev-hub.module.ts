import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { JobsModule } from "../jobs/jobs.module.js";
import { AdminSpaController } from "./admin-spa.controller.js";
import { DevFilesController } from "./dev-files.controller.js";
import { DevHubController } from "./dev-hub.controller.js";
import { MigrationsService } from "./migrations/migrations.service.js";
import { RouteInventoryService } from "./route-inventory-runner.js";
import { RealtimeModule } from "../realtime/realtime.module.js";

/**
 * DevHubModule — registers the `/dev` and `/admin` SPA controllers.
 *
 * Loaded unconditionally; both controllers short-circuit to a 404
 * outside `NODE_ENV=development` so they can never leak tool URLs in
 * production.
 *
 * `DiscoveryModule` is imported so `RouteInventoryService` can walk
 * the registered controllers for `/dev/routes`. `MigrationsService` is
 * a dev-only orchestrator for the `/dev/migrations` page; it depends on
 * the global `PrismaService` for advisory locks + `_prisma_migrations`
 * reads. `JobsModule` is imported so the controller can read the
 * in-memory queue history for the `/dev/jobs/*` dashboard.
 * `RealtimeModule` is imported so the AdminSpa controller can read
 * the inspector snapshot and drive the disconnect / send / replay
 * actions.
 */
@Module({
  imports: [DiscoveryModule, JobsModule, RealtimeModule],
  // Order matters: `DevFilesController` registers before `DevHubController`
  // so its specific `/dev/files/*.json` routes win over the latter's
  // `@Get('*splat')` SPA-shell catch-all.
  controllers: [DevFilesController, AdminSpaController, DevHubController],
  providers: [RouteInventoryService, MigrationsService],
  exports: [RouteInventoryService],
})
export class DevHubModule {}
