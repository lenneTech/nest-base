import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { AdminSpaController } from "./admin-spa.controller.js";
import { DevHubController } from "./dev-hub.controller.js";
import { RouteInventoryService } from "./route-inventory-runner.js";

/**
 * DevHubModule — registers the `/dev` and `/admin` SPA controllers.
 *
 * Loaded unconditionally; both controllers short-circuit to a 404
 * outside `NODE_ENV=development` so they can never leak tool URLs in
 * production.
 *
 * `DiscoveryModule` is imported so `RouteInventoryService` can walk
 * the registered controllers for `/dev/routes`.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [DevHubController, AdminSpaController],
  providers: [RouteInventoryService],
  exports: [RouteInventoryService],
})
export class DevHubModule {}
