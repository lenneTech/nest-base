import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

import { TraceBufferSpanProcessor } from "./trace-buffer-span-processor.js";

/**
 * OpenTelemetry SDK bootstrap (TR.BE.16).
 *
 * The PRD's TR.BE.16 requires `@opentelemetry/sdk-node` plus the
 * auto-instrumentations bundle so HTTP / Express / Prisma calls
 * emit spans automatically — the API package alone (already shipped
 * via @opentelemetry/api) only provides the contract, not the
 * pipeline that pushes spans to a collector.
 *
 * The bootstrap splits into a pure planner (`planOtelBootstrap`)
 * and a runner (`createOtelSdk`):
 *   - planner: given feature flag + endpoint, decides whether to
 *     enable the SDK and what service name to use.
 *   - runner: instantiates `NodeSDK` with the OTLP HTTP exporter
 *     and the auto-instrumentations bundle. The caller decides
 *     when to call `sdk.start()` (typically in `main.ts` before
 *     NestJS app bootstrap).
 *
 * When `features.observability.enabled` is false (or the OTLP
 * endpoint is not configured), the planner returns `enabled: false`
 * with a reason. The runner then either skips SDK construction
 * entirely or builds a no-op shell — that decision lives at the
 * caller because it knows whether to swallow the SDK footprint.
 *
 * The custom span buffer (`src/core/dx/trace-buffer.ts` / CF.OBS.07)
 * runs as a parallel SpanProcessor — independent of this OTLP
 * exporter — so `/dev/traces` keeps working even when the OTLP
 * endpoint is unreachable.
 */

const DEFAULT_SERVICE_NAME = "nest-base";

export interface OtelBootstrapInput {
  /** From `features.observability.enabled`. */
  readonly observabilityEnabled: boolean;
  /** OTLP HTTP traces endpoint, e.g. `http://otel-collector:4318/v1/traces`. */
  readonly otlpEndpoint: string | undefined;
  /** Service name for resource attributes; defaults to `nest-base`. */
  readonly serviceName: string | undefined;
}

export type OtelBootstrapPlan =
  | {
      readonly enabled: true;
      readonly serviceName: string;
      readonly otlpEndpoint: string;
    }
  | {
      readonly enabled: false;
      readonly reason: string;
    };

export function planOtelBootstrap(input: OtelBootstrapInput): OtelBootstrapPlan {
  if (!input.observabilityEnabled) {
    return { enabled: false, reason: "observability disabled in feature flags" };
  }
  const endpoint = (input.otlpEndpoint ?? "").trim();
  if (endpoint === "") {
    return {
      enabled: false,
      reason: "OTLP endpoint not configured (set OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)",
    };
  }
  return {
    enabled: true,
    serviceName: input.serviceName?.trim() || DEFAULT_SERVICE_NAME,
    otlpEndpoint: endpoint,
  };
}

export interface OtelSdkRunnerInput {
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly otlpEndpoint: string;
}

/**
 * Build a NodeSDK instance. Caller is responsible for invoking
 * `sdk.start()` and `sdk.shutdown()` at the appropriate lifecycle
 * points. Returns the SDK regardless of `enabled` so the caller
 * can keep a uniform reference; consult the planner's `enabled`
 * flag before wiring it into bootstrap.
 */
export function createOtelSdk(input: OtelSdkRunnerInput): NodeSDK {
  const traceExporter = new OTLPTraceExporter({
    url: input.otlpEndpoint,
  });

  // The TraceBufferSpanProcessor mirrors every ended span into the
  // in-memory buffer that backs `/dev/traces`. Runs in parallel with
  // the OTLP exporter so the dev surface keeps working when the
  // collector is unreachable, and so DB / Prisma / HTTP-client
  // spans (emitted by the auto-instrumentations bundle) land in
  // the dev panel — the previous HTTP-middleware-only feed only
  // captured inbound HTTP requests.
  const traceBufferProcessor = new TraceBufferSpanProcessor();

  return new NodeSDK({
    serviceName: input.serviceName,
    traceExporter,
    spanProcessors: [traceBufferProcessor],
    instrumentations: [getNodeAutoInstrumentations()],
  });
}
