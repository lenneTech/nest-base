/**
 * UserAdminModule — registers the `/hub/admin/users/*` controller
 * (issue #86).
 *
 * Kept as a slim wrapper so AppModule's import list stays symmetrical
 * with the other admin modules (SessionsAdminModule, AdminCrudModule)
 * and the controller can be tested or replaced independently.
 */
import { Module } from "@nestjs/common";

import { BetterAuthModule } from "../auth/better-auth.module.js";
import { ConfigModule } from "../config/config.module.js";
import { PermissionsModule } from "../permissions/permissions.module.js";
import { UserAdminController } from "./user-admin.controller.js";

@Module({
  imports: [
    // BetterAuthModule exports the BETTER_AUTH_INSTANCE token that
    // UserAdminController injects with @Optional() — importing here
    // ensures DI wires it when BA is configured, falls back gracefully
    // when it isn't (e.g., BETTER_AUTH_SECRET not set in test builds).
    BetterAuthModule,
    // ConfigModule provides ConfigService so callBaAdmin()
    // can read server.env and server.baseUrl without re-parsing process.env
    // via Zod on every request (MIN-2 fix).
    ConfigModule.forRoot(),
    PermissionsModule,
  ],
  controllers: [UserAdminController],
})
export class UserAdminModule {}
