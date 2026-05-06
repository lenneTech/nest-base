import { Injectable } from "@nestjs/common";
import { type CounterConfiguration, Counter, Registry, collectDefaultMetrics } from "prom-client";

/**
 * MetricsService — owns a per-instance prom-client Registry that
 * exposes Node.js process + custom application metrics over the
 * standard Prometheus text-format exposition.
 *
 * Why a per-instance Registry rather than the prom-client global
 * default registry: the global registry is process-scoped and leaks
 * across test files. Each `new MetricsService()` gets its own
 * Registry so unit/story tests can register custom counters without
 * polluting the production exposition.
 *
 * The standard set of Node.js process metrics (process_cpu_*,
 * nodejs_heap_*, nodejs_eventloop_lag_seconds, nodejs_active_handles,
 * etc.) are registered automatically via `collectDefaultMetrics`.
 *
 * Closes:
 *   - CF.OBS.12 (Prometheus /metrics)
 *   - TR.BE.17 (prom-client → /metrics)
 */
@Injectable()
export class MetricsService {
  private readonly registry: Registry;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });
  }

  /**
   * Returns the Prometheus text-format exposition that the
   * `/metrics` controller hands to scrapers.
   */
  async snapshot(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Returns the Content-Type header value that scrapers expect for
   * the prom-client text format (`text/plain; version=0.0.4;
   * charset=utf-8`).
   */
  contentType(): string {
    return this.registry.contentType;
  }

  /**
   * Register a custom counter on this service's Registry. Used by
   * project modules (and the story tests) to track per-feature
   * counts without leaking into the global default registry.
   */
  counter<T extends string = string>(config: CounterConfiguration<T>): Counter<T> {
    return new Counter<T>({ ...config, registers: [this.registry] });
  }

  /**
   * Drop every metric registered on this service. Mainly for tests
   * that want a clean slate between cases.
   */
  reset(): void {
    this.registry.resetMetrics();
  }
}
