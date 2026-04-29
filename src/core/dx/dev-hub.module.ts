import { Module } from "@nestjs/common";

import { AdminUiController } from "./admin-ui.controller.js";
import { DevHubController } from "./dev-hub.controller.js";

/**
 * DevHubModule — registers the `/dev` landing page controller.
 *
 * Loaded unconditionally; the controller itself short-circuits to a
 * 404 response outside `NODE_ENV=development` so it can never leak
 * tool URLs in production.
 */
@Module({
  controllers: [DevHubController, AdminUiController],
})
export class DevHubModule {}
