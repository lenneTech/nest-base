import { Module } from "@nestjs/common";

import { HubPortalMiddleware } from "./hub-portal.middleware.js";

/**
 * HubModule — operator-portal CASL gate (Better-Auth session required).
 */
@Module({
  providers: [HubPortalMiddleware],
  exports: [HubPortalMiddleware],
})
export class HubModule {}
