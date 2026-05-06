/**
 * UserAdminModule — registers the `/admin/users/*` controller
 * (issue #86).
 *
 * Kept as a slim wrapper so AppModule's import list stays symmetrical
 * with the other admin modules (SessionsAdminModule, AdminCrudModule)
 * and the controller can be tested or replaced independently.
 */
import { Module } from "@nestjs/common";

import { BetterAuthModule } from "../auth/better-auth.module.js";
import { UserAdminController } from "./user-admin.controller.js";

@Module({
  imports: [
    // BetterAuthModule exports the BETTER_AUTH_INSTANCE token that
    // UserAdminController injects with @Optional() — importing here
    // ensures DI wires it when BA is configured, falls back gracefully
    // when it isn't (e.g., BETTER_AUTH_SECRET not set in test builds).
    BetterAuthModule,
  ],
  controllers: [UserAdminController],
})
export class UserAdminModule {}
