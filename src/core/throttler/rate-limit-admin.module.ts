/**
 * RateLimitAdminModule — wires the `/hub/admin/rate-limits/*` controller (issue #94).
 *
 * `RateLimitConfigService` is the memory-cached layer that loads and refreshes
 * operator-edited rate-limit windows from Postgres. The controller uses it
 * plus the bare `PrismaService` for decision history / allowlist queries.
 */

import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module.js";
import { RateLimitAdminController } from "./rate-limit-admin.controller.js";
import { RateLimitConfigService } from "./rate-limit-config.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [RateLimitAdminController],
  providers: [RateLimitConfigService],
  exports: [RateLimitConfigService],
})
export class RateLimitAdminModule {}
