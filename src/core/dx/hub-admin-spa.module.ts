import { Module } from "@nestjs/common";

import { AdminSpaController } from "./admin-spa.controller.js";
import { RealtimeModule } from "../realtime/realtime.module.js";

/**
 * HubAdminSpaModule — registers the `/hub/admin` SPA controller
 * (permission tester, webhook/realtime inspectors, audit browser,
 * search tester, jobs shell).
 *
 * Split out of `HubSpaModule` for ROUTE REGISTRATION ORDER: Express
 * matches in registration order, and two orderings must hold at once:
 *
 *   1. `AdminSpaController`'s `GET hub/admin/permissions/test(.json)`
 *      must register BEFORE `AdminPermissionsController`'s `GET :id`
 *      (admin-crud.module.ts) — otherwise `:id` swallows `test.json`.
 *      → this module is imported EARLY in `AppModule`.
 *   2. `HubController`'s `GET /hub/*splat` SPA-shell catch-all must
 *      register AFTER every `/hub/admin/*` controller.
 *      → `HubSpaModule` is imported LAST among the portal modules.
 *
 * `RealtimeModule` is imported so the controller can read the inspector
 * snapshot and drive the disconnect / send / replay actions.
 */
@Module({
  imports: [RealtimeModule],
  controllers: [AdminSpaController],
})
export class HubAdminSpaModule {}
