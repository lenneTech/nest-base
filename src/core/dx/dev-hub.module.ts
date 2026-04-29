import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { AdminUiController } from "./admin-ui.controller.js";
import { DevHubController } from "./dev-hub.controller.js";
import { RouteInventoryService } from "./route-inventory-runner.js";

/**
 * DevHubModule — registers the `/dev` landing page controller.
 *
 * Loaded unconditionally; the controller itself short-circuits to a
 * 404 response outside `NODE_ENV=development` so it can never leak
 * tool URLs in production.
 *
 * `DiscoveryModule` is imported so `RouteInventoryService` can walk
 * the registered controllers for `/dev/routes`.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [DevHubController, AdminUiController],
  providers: [RouteInventoryService],
  exports: [RouteInventoryService],
})
export class DevHubModule {}
