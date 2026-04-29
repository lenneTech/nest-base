import { Module } from '@nestjs/common';

import { PowerSyncController } from './powersync.controller.js';

/**
 * PowerSyncModule — exposes `/powersync/crud` for the offline-sync
 * upload-batch from mobile clients. JWKS endpoint for the JWT
 * `audience: powersync` flow is mounted by Better-Auth's `jwt`
 * plugin once that's enabled in the BetterAuthModule.
 */
@Module({
  controllers: [PowerSyncController],
})
export class PowerSyncModule {}
