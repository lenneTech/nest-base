import { describe, expect, it } from "vitest";

/**
 * Story · Prometheus `/metrics` exposition (CF.OBS.12 + TR.BE.17).
 *
 * The PRD requires a `prom-client`-driven `/metrics` endpoint emitting
 * the standard Prometheus text-format exposition (`text/plain;
 * version=0.0.4`). Operators wire their Prometheus scraper at this
 * endpoint to track request rates, latency histograms, GC pauses,
 * heap usage, etc.
 *
 * The implementation lives in `src/core/metrics/` and ships:
 *   - `MetricsService` — wraps `prom-client.Registry` with a default
 *     metrics collector (process_cpu_seconds_total, nodejs_*, etc.)
 *   - `MetricsController` — `GET /metrics` returns the registry's
 *     metrics text + the right Content-Type header.
 *   - `MetricsModule` — feature-gated NestJS module.
 *
 * The route is `@Public("Prometheus scraper endpoint")` because
 * scrapers don't carry user sessions; the scrape itself is gated by
 * the Prometheus operator's own auth boundary (typically network).
 */
describe("Story · Prometheus /metrics exposition", () => {
  describe("MetricsService — default-metrics registry", () => {
    it("registers the standard Node.js process metrics", async () => {
      const { MetricsService } = await import("../../src/core/metrics/metrics.service.js");
      const service = new MetricsService();
      const text = await service.snapshot();
      // The standard prom-client Node default-metrics include these.
      // We assert the names appear in the exposition text.
      expect(text).toMatch(/process_cpu_user_seconds_total/);
      expect(text).toMatch(/nodejs_/);
    });

    it("returns prom-client text-format exposition", async () => {
      const { MetricsService } = await import("../../src/core/metrics/metrics.service.js");
      const service = new MetricsService();
      const text = await service.snapshot();
      // Prometheus text format: lines starting with `#` (HELP/TYPE) or
      // `<metric_name>{<labels>} <value>`. Verify HELP/TYPE markers.
      expect(text).toMatch(/^# HELP /m);
      expect(text).toMatch(/^# TYPE /m);
    });

    it("exposes the registry's contentType for scrapers", async () => {
      const { MetricsService } = await import("../../src/core/metrics/metrics.service.js");
      const service = new MetricsService();
      expect(service.contentType()).toMatch(/text\/plain/);
      expect(service.contentType()).toMatch(/version=/);
    });

    it("isolates per-instance counters so tests do not bleed", async () => {
      const { MetricsService } = await import("../../src/core/metrics/metrics.service.js");
      const a = new MetricsService();
      const b = new MetricsService();
      // Increment a custom counter on `a` only — `b`'s registry must not
      // observe it. (Without per-instance isolation, prom-client's global
      // default registry would leak across instances.)
      const counter = a.counter({
        name: "story_test_counter",
        help: "Story test counter — fusion port completeness",
      });
      counter.inc(7);
      const aText = await a.snapshot();
      const bText = await b.snapshot();
      expect(aText).toMatch(/story_test_counter 7/);
      expect(bText).not.toMatch(/story_test_counter/);
    });
  });
});
