import { Module } from "@nestjs/common";

import { PrismaModule } from "../../core/prisma/prisma.module.js";

import { UserProfileController } from "./user-profile.controller.js";
import { UserProfileService } from "./user-profile.service.js";

/**
 * UserProfileModule — wires `/me/profile` against the slim service.
 *
 * The service depends on `PrismaService` directly. No repository
 * abstraction. Tests use the `tests/lib/fake-prisma` helper.
 */
@Module({
  imports: [PrismaModule],
  controllers: [UserProfileController],
  providers: [UserProfileService],
  exports: [UserProfileService],
})
export class UserProfileModule {}
