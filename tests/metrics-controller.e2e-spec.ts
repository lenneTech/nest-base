import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SILENT_LOGGER = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

/**
 * E2E · /metrics endpoint (CF.OBS.12 + TR.BE.17).
 *
 * The PRD pins prom-client → /metrics. The endpoint returns the
 * Prometheus text-format exposition for the Node process metrics
 * (`process_cpu_*`, `nodejs_heap_*`, `nodejs_eventloop_lag_seconds`,
 * etc.) plus any custom counters projects register through
 * `MetricsService.counter()`.
 *
 * The test boots the full app (default features include
 * `observability.enabled: true`) and asserts:
 *   - HTTP 200 with the prom-client content-type header
 *   - body contains the canonical metric names + the OpenMetrics
 *     comment lines (`# HELP …`, `# TYPE …`)
 *   - the route is registered under `/metrics` (no auth required —
 *     scrape jobs are gated by network policy, not session cookies)
 */
describe("E2E · /metrics — Prometheus exposition (CF.OBS.12 + TR.BE.17)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { bootstrap } = await import("../src/core/app/bootstrap.js");
    app = await bootstrap({ listen: false, logger: SILENT_LOGGER });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /metrics returns 200 with the prom-client text-format content-type", async () => {
    const res = await request(app.getHttpServer()).get("/api/metrics");
    expect(res.status).toBe(200);
    // prom-client default: `text/plain; version=0.0.4; charset=utf-8`.
    // Don't pin the exact suffix — content-type negotiation in
    // Node/Express may add charset variations across versions.
    expect(res.headers["content-type"]).toMatch(/text\/plain.*version=0\.0\.4/);
  });

  it("GET /metrics body contains the standard Node.js process metrics", async () => {
    const res = await request(app.getHttpServer()).get("/api/metrics");
    expect(res.status).toBe(200);
    const body = res.text;
    // collectDefaultMetrics() registers these under the Registry.
    expect(body).toContain("process_cpu_user_seconds_total");
    expect(body).toContain("process_resident_memory_bytes");
    expect(body).toContain("nodejs_heap_size_total_bytes");
    expect(body).toContain("nodejs_eventloop_lag_seconds");
  });

  it("GET /metrics body has the canonical OpenMetrics comment headers", async () => {
    const res = await request(app.getHttpServer()).get("/api/metrics");
    expect(res.status).toBe(200);
    const body = res.text;
    // Every metric in the prom-client exposition has matching # HELP
    // and # TYPE comment lines. We check at least one pair to lock in
    // the OpenMetrics-compliant shape.
    expect(body).toMatch(/# HELP process_cpu_user_seconds_total/);
    expect(body).toMatch(/# TYPE process_cpu_user_seconds_total/);
  });

  it("the endpoint is reachable without auth (Public(): scrape jobs gate via network)", async () => {
    // No cookie / Authorization header / x-tenant-id sent. A 401/403
    // would mean the @Public() decorator didn't take effect.
    const res = await request(app.getHttpServer()).get("/api/metrics");
    expect(res.status).toBe(200);
  });
});
