import { Controller, Get } from "@nestjs/common";

import { APP_NAME, APP_VERSION } from "./app.metadata.js";
import { Public } from "../permissions/public.decorator.js";

/**
 * Root-level API identity endpoint.
 *
 * With the global `/api/` prefix (issue #83), this controller registers
 * at `GET /api/` rather than `GET /`. The Hub SPA has taken over `GET /`.
 *
 * `/health/{live,ready}` is a separate slice and lives in its own
 * controller (excluded from the global prefix so it stays at `/health/*`).
 */
@Controller()
export class AppController {
  @Get()
  @Public("API identity endpoint — public server name/version for SDK consumers and health checks")
  index(): { name: string; version: string } {
    return { name: APP_NAME, version: APP_VERSION };
  }
}
