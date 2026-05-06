import { Module } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { buildDefaultGdprErasureRunnerInput } from "./gdpr-erasure.factory.js";
import { GdprErasureRunner } from "./gdpr-erasure.runner.js";
import { GdprExportJobRegistry } from "./gdpr-export.registry.js";
import { GdprController } from "./gdpr.controller.js";

/**
 * GdprModule — exposes `/me/export` (data export) and
 * `DELETE /me/account` (account erasure) per GDPR Art. 15 / Art. 17.
 *
 * Iter-75 added the GdprErasureRunner — a `@ScheduledJob`-decorated
 * daily cron that walks pending-erasure records, picks those past
 * the 30-day grace window via `planGdprGracePeriodErasures()`, and
 * executes the project's erasure mechanism. Iter-88 closed the
 * audit-finding by binding the production factory
 * (`buildDefaultGdprErasureRunnerInput`) so the cron tick anonymises
 * users out-of-the-box: real Prisma reads from the
 * `pending_erasures` table, anonymise-User implementation that
 * sentinel-replaces PII + deletes secondary credential tables, and
 * a real `completed_at` watermark write. Projects override the
 * provider for hard-delete or stricter erasure semantics.
 */
@Module({
  controllers: [GdprController],
  providers: [
    GdprExportJobRegistry,
    {
      provide: GdprErasureRunner,
      useFactory: (prisma: PrismaService) =>
        new GdprErasureRunner(buildDefaultGdprErasureRunnerInput({ prisma })),
      inject: [PrismaService],
    },
  ],
  exports: [GdprErasureRunner, GdprExportJobRegistry],
})
export class GdprModule {}
