import { Controller, Get, HttpCode, HttpStatus, HttpException } from "@nestjs/common";

import { HealthService, type ReadinessReport } from "./health.service.js";

/**
 * Health endpoints (PLAN.md §24).
 *
 * - `/health/live` — process probe; never queries dependencies.
 * - `/health/ready` — readiness probe; pings DB + critical deps and
 *   returns 503 when any check fails so the LB can drain.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  @HttpCode(HttpStatus.OK)
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== "ok") {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
