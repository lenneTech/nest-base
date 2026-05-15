import { Controller, Get, HttpCode, HttpStatus, HttpException } from "@nestjs/common";

import { Public } from "../permissions/public.decorator.js";
import { HealthService, type ReadinessReport } from "./health.service.js";

/**
 * Health endpoints.
 *
 * - `/health/live` — process probe; never queries dependencies.
 * - `/health/ready` — readiness probe; pings DB + critical deps and
 *   returns 503 when any check fails so the LB can drain.
 *
 * Both endpoints are `@Public` because they MUST be reachable by the
 * k8s liveness/readiness probes without authentication credentials.
 * The `/health/*` prefix is also in the JWT-middleware PUBLIC_PREFIXES
 * allowlist for defense-in-depth.
 */
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  @HttpCode(HttpStatus.OK)
  @Public("k8s liveness probe — intentionally unauthenticated")
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("ready")
  @Public("k8s readiness probe — intentionally unauthenticated")
  async ready(): Promise<ReadinessReport> {
    const report = await this.health.readiness();
    if (report.status !== "ok") {
      throw new HttpException(report, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
