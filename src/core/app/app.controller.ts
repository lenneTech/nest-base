import { Controller, Get } from '@nestjs/common';

import { APP_NAME, APP_VERSION } from './app.metadata.js';

/**
 * Root controller. Exposes the public-facing server identity at `GET /`.
 *
 * `/health/{live,ready}` is a separate slice (Phase 1 line 3651) and
 * lives in its own controller.
 */
@Controller()
export class AppController {
  @Get()
  index(): { name: string; version: string } {
    return { name: APP_NAME, version: APP_VERSION };
  }
}
