import { Controller, Get, Header, Res } from "@nestjs/common";
import type { Response } from "express";

import { Public } from "../permissions/public.decorator.js";
import { MetricsService } from "./metrics.service.js";

/**
 * `/metrics` — Prometheus text-format exposition (CF.OBS.12 / TR.BE.17).
 *
 * The PRD pins prom-client → /metrics: a Prometheus scraper hits this
 * endpoint and reads the `MetricsService` Registry's text-format
 * snapshot. The Content-Type header is set to the prom-client default
 * (`text/plain; version=0.0.4; charset=utf-8`) so any standard
 * Prometheus / OpenMetrics scraper parses it correctly.
 *
 * `@Public()` because Prometheus scrape jobs can't carry a session
 * cookie or an API key — the standard pattern is to gate the endpoint
 * via network policy (only scrapers in the same VPC reach it) rather
 * than auth. The reason string lands in the route audit so it's
 * clear in `/dev/routes`.
 */
@Controller("metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * `GET /metrics` — returns the prom-client exposition for the
   * default (Node process) + custom counters registered through
   * `MetricsService.counter()`.
   */
  @Public("Prometheus scrape endpoint — gated by network policy, not auth")
  @Get()
  @Header("cache-control", "no-store")
  async expose(@Res() res: Response): Promise<void> {
    const body = await this.metricsService.snapshot();
    res.setHeader("content-type", this.metricsService.contentType());
    res.send(body);
  }
}
