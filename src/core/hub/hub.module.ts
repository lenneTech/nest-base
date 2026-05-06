import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module.js";
import { HubController } from "./hub.controller.js";
import { HubPasswordService } from "./hub-password.service.js";
import { HubSessionService } from "./hub-session.service.js";

/**
 * HubModule — mounts the Hub SPA at `/` with stage-aware auth.
 *
 * Loaded unconditionally. On local stage the Hub is unauthenticated;
 * on non-local stages the password guard kicks in automatically
 * via `HubPasswordService.onApplicationBootstrap`.
 *
 * `PrismaModule` is imported so `HubPasswordService` can read/write
 * `system_secrets` for the Hub password hash.
 */
@Module({
  imports: [PrismaModule],
  controllers: [HubController],
  providers: [HubPasswordService, HubSessionService],
  exports: [HubPasswordService, HubSessionService],
})
export class HubModule {}
