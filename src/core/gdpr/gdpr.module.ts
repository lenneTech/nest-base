import { Module } from "@nestjs/common";

import { GdprController } from "./gdpr.controller.js";

/**
 * GdprModule — exposes `/me/export` (data export) and
 * `DELETE /me/account` (account erasure) per GDPR Art. 15 / Art. 17.
 *
 * Both endpoints currently return stub payloads — the actual data
 * fetch hooks into project-specific contributors once Better-Auth's
 * Prisma adapter + the per-resource erasure registries land.
 */
@Module({
  controllers: [GdprController],
})
export class GdprModule {}
