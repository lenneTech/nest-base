/**
 * TenantAdminModule — registers the `/admin/tenants/*` controller
 * (issue #87).
 *
 * Kept as a slim wrapper so AppModule's import list stays symmetrical
 * with the other admin modules (UserAdminModule, SessionsAdminModule)
 * and the controller can be tested or replaced independently.
 */
import { Module } from "@nestjs/common";

import { BetterAuthModule } from "../auth/better-auth.module.js";
import { ConfigModule } from "../config/config.module.js";
import { TenantAdminController } from "./tenant-admin.controller.js";

@Module({
  imports: [
    // BetterAuthModule exports the BETTER_AUTH_INSTANCE token that
    // TenantAdminController injects with @Optional() — importing here
    // ensures DI wires it when BA is configured, falls back gracefully
    // when it isn't (e.g., BETTER_AUTH_SECRET not set in test builds).
    BetterAuthModule,
    // ConfigModule provides ConfigService so callBaOrgAdmin()
    // can read server.env and server.baseUrl without re-parsing process.env
    // via Zod on every request (MIN-2 fix).
    ConfigModule.forRoot(),
  ],
  controllers: [TenantAdminController],
})
export class TenantAdminModule {}
