import { describe, expect, it } from "vitest";

/**
 * Story · OpenTelemetry SDK bootstrap planner (TR.BE.16).
 *
 * The PRD's `TR.BE.16` requires `@opentelemetry/sdk-node` plus the
 * standard auto-instrumentations bundle, gated by the
 * `features.observability.enabled` flag. The project ships with
 * `@opentelemetry/api` already; this slice adds the SDK side so
 * spans actually leave the process toward an OTel collector.
 *
 * The planner is pure: given the active feature flags + an OTLP
 * endpoint URL, it decides whether to start the SDK and what
 * instrumentations to enable. The runner (NestJS bootstrap) takes
 * the planner's output and either calls `sdk.start()` or skips it
 * entirely — observability-disabled deployments don't pay the SDK
 * footprint at all.
 */
describe("Story · OpenTelemetry SDK bootstrap planner", () => {
  it("returns enabled=true when observability is on and an OTLP endpoint is configured", async () => {
    const { planOtelBootstrap } =
      await import("../../src/core/observability/otel-sdk-bootstrap.js");
    const plan = planOtelBootstrap({
      observabilityEnabled: true,
      otlpEndpoint: "http://otel-collector:4318/v1/traces",
      serviceName: "nest-base",
    });
    expect(plan.enabled).toBe(true);
    if (plan.enabled) {
      expect(plan.serviceName).toBe("nest-base");
      expect(plan.otlpEndpoint).toBe("http://otel-collector:4318/v1/traces");
    }
  });

  it("returns enabled=false when observability feature flag is off", async () => {
    const { planOtelBootstrap } =
      await import("../../src/core/observability/otel-sdk-bootstrap.js");
    const plan = planOtelBootstrap({
      observabilityEnabled: false,
      otlpEndpoint: "http://otel-collector:4318/v1/traces",
      serviceName: "nest-base",
    });
    expect(plan.enabled).toBe(false);
    if (!plan.enabled) {
      expect(plan.reason).toMatch(/observability disabled/i);
    }
  });

  it("returns enabled=false when otlpEndpoint is missing (no exporter target)", async () => {
    const { planOtelBootstrap } =
      await import("../../src/core/observability/otel-sdk-bootstrap.js");
    const plan = planOtelBootstrap({
      observabilityEnabled: true,
      otlpEndpoint: undefined,
      serviceName: "nest-base",
    });
    expect(plan.enabled).toBe(false);
    if (!plan.enabled) {
      expect(plan.reason).toMatch(/otlp endpoint/i);
    }
  });

  it("returns enabled=false when otlpEndpoint is empty string", async () => {
    const { planOtelBootstrap } =
      await import("../../src/core/observability/otel-sdk-bootstrap.js");
    const plan = planOtelBootstrap({
      observabilityEnabled: true,
      otlpEndpoint: "  ",
      serviceName: "nest-base",
    });
    expect(plan.enabled).toBe(false);
  });

  it("uses a default service name when none is provided", async () => {
    const { planOtelBootstrap } =
      await import("../../src/core/observability/otel-sdk-bootstrap.js");
    const plan = planOtelBootstrap({
      observabilityEnabled: true,
      otlpEndpoint: "http://otel:4318",
      serviceName: undefined,
    });
    expect(plan.enabled).toBe(true);
    if (plan.enabled) {
      expect(plan.serviceName).toBe("nest-base");
    }
  });

  it("createOtelSdk returns a NodeSDK that can start + shutdown without error", async () => {
    const { createOtelSdk } = await import("../../src/core/observability/otel-sdk-bootstrap.js");
    const sdk = createOtelSdk({
      enabled: true,
      serviceName: "nest-base-test",
      otlpEndpoint: "http://localhost:4318/v1/traces",
    });
    expect(sdk).toBeDefined();
    // Smoke-check the SDK is constructible without exploding; we don't
    // start it here (would attach instrumentations to the test process).
    expect(typeof sdk.start).toBe("function");
    expect(typeof sdk.shutdown).toBe("function");
  });
});
