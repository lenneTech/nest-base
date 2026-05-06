import { Logger, Module } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service.js";
import { PrismaModule } from "../prisma/prisma.module.js";

import {
  InMemoryPowerSyncStore,
  POWER_SYNC_STORE,
  PrismaPowerSyncStore,
  type PowerSyncStore,
} from "./powersync-store.js";
import { PowerSyncController } from "./powersync.controller.js";

/**
 * PowerSyncModule — exposes `/powersync/crud` for the offline-sync
 * upload-batch from mobile clients. JWKS endpoint for the JWT
 * `audience: powersync` flow is mounted by Better-Auth's `jwt`
 * plugin once that's enabled in the BetterAuthModule.
 *
 * Iter-216 CF.PS.04 closure: the controller injects a `PowerSyncStore`
 * — Prisma-backed when the `power_sync_rows` table is reachable
 * (feature schema loaded + migration applied), in-memory otherwise.
 * Graceful degradation lets a project enable PowerSync at runtime
 * without re-running `prepare:schema` + `prisma generate` first
 * (the boot logs a warning and persistence is in-process only until
 * the schema build catches up). Domain modules override the binding
 * via the `POWER_SYNC_STORE` token when they want per-resource
 * storage.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PowerSyncController],
  providers: [
    {
      provide: POWER_SYNC_STORE,
      useFactory: (prisma: PrismaService): PowerSyncStore => {
        const erased: unknown = prisma;
        const candidate = erased as { powerSyncRow?: { findMany?: unknown } };
        if (candidate.powerSyncRow && typeof candidate.powerSyncRow.findMany === "function") {
          return new PrismaPowerSyncStore(prisma);
        }
        new Logger("PowerSyncModule").warn(
          "Prisma client lacks `powerSyncRow` delegate — falling back to in-memory store. " +
            "Run `bun run prepare:schema && bunx prisma generate` after enabling the powersync feature.",
        );
        return new InMemoryPowerSyncStore();
      },
      inject: [PrismaService],
    },
  ],
  exports: [POWER_SYNC_STORE],
})
export class PowerSyncModule {}

export type { PowerSyncStore };
