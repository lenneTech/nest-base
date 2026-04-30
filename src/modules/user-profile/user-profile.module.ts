import { Module } from "@nestjs/common";

import { PrismaModule } from "../../core/prisma/prisma.module.js";

import { InMemoryUserProfileRepository } from "./user-profile.repository.in-memory.js";
import { PrismaUserProfileRepository } from "./user-profile.repository.prisma.js";
import { UserProfileController } from "./user-profile.controller.js";
import { UserProfileService } from "./user-profile.service.js";
import { USER_PROFILE_REPOSITORY } from "./user-profile.tokens.js";

/**
 * UserProfileModule — wires `/me/profile` GET/PATCH against either
 * the Prisma-backed (default) or in-memory repository.
 *
 * Default binding is `PrismaUserProfileRepository` because that's the
 * production case. The schema + migration ship in
 * `prisma/schema.prisma` and `prisma/migrations/20260430000100_user_profile_module/`
 * — `bun run prisma:migrate` enables the route end-to-end.
 *
 * Tests use the in-memory repo directly (no DI needed).
 */
@Module({
  imports: [PrismaModule],
  controllers: [UserProfileController],
  providers: [
    UserProfileService,
    InMemoryUserProfileRepository,
    PrismaUserProfileRepository,
    { provide: USER_PROFILE_REPOSITORY, useClass: PrismaUserProfileRepository },
  ],
  exports: [UserProfileService],
})
export class UserProfileModule {}
