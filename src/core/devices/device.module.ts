import { Module } from "@nestjs/common";

import { PrismaModule } from "../prisma/prisma.module.js";
import { DeviceController } from "./device.controller.js";

/**
 * DeviceModule — owns the `/me/devices` endpoints.
 *
 * The Better-Auth `databaseHooks.session.create.after` orchestrator
 * does NOT live in this module — it's wired inside `BetterAuthModule`
 * (which already constructs the Better-Auth instance). This module
 * just publishes the read / revoke surface to the rest of the app.
 *
 * Wiring is unconditional: the feature flag governs whether the
 * fingerprint pipeline runs at session-create time. The endpoints
 * here are still useful when the feature is off — they list raw
 * sessions, just without a fingerprint to compare against.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DeviceController],
})
export class DeviceModule {}
