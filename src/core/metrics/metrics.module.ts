import { Module } from "@nestjs/common";

import { MetricsController } from "./metrics.controller.js";
import { MetricsService } from "./metrics.service.js";

/**
 * MetricsModule — exposes `/metrics` (Prometheus text-format) and
 * makes `MetricsService` available for projects that want to
 * register custom counters (`MetricsService.counter(...)`).
 *
 * Mounted conditionally behind `features.observability.enabled`
 * (default-on) at the AppModule level. When observability is off,
 * the controller is not registered and `/metrics` returns 404 —
 * keeping the prom-client default-collectors out of the heap.
 */
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
