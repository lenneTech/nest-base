import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { AppController } from './app.controller.js';

/**
 * Root module of the NestJS application.
 *
 * Subsequent slices register their feature modules here (Auth, Permissions,
 * Files, Realtime, …) — all behind feature flags so Konsumenten only pull
 * in what they enabled in `features.ts`.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AppController],
})
export class AppModule {}
