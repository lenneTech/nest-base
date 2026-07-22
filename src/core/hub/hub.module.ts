import { Module } from "@nestjs/common";

import { HubPortalMiddleware } from "./hub-portal.middleware.js";
import { LegacyAdminRedirectController } from "./legacy-admin-redirect.controller.js";

/**
 * HubModule — operator-portal CASL gate (Better-Auth session required)
 * plus the legacy `/admin/*` → `/hub/admin/*` 308 bridge.
 */
@Module({
  controllers: [LegacyAdminRedirectController],
  providers: [HubPortalMiddleware],
  exports: [HubPortalMiddleware],
})
export class HubModule {}
