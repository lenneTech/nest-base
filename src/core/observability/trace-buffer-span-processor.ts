import type { Context } from "@opentelemetry/api";
import type { ReadableSpan, Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";

import { type TraceBuffer, getTraceBuffer } from "../dx/trace-buffer.js";

/**
 * `TraceBufferSpanProcessor` (CF.OBS.07).
 *
 * OTel `SpanProcessor` that mirrors every ended span into the
 * in-memory `TraceBuffer` consumed by `/hub/traces`. Runs in
 * parallel with the OTLP exporter so the dev surface keeps
 * working even when the OTLP collector is unreachable.
 *
 * Why intercept spans instead of the existing HTTP middleware:
 *  - Auto-instrumentations emit spans for DB / Prisma / HTTP-client
 *    calls. The middleware-based feed only captures inbound HTTP
 *    requests and misses every interesting span the rest of the
 *    request makes.
 *  - The same buffer surface (`record`, `since`, `recent`,
 *    `summary`) accepts both — the processor maps the OTel
 *    span shape into the buffer's `TraceRecord` shape.
 */
export class TraceBufferSpanProcessor implements SpanProcessor {
  constructor(private readonly buffer: TraceBuffer = getTraceBuffer()) {}

  /** Ignored — buffer captures finished spans only. */
  onStart(_span: Span, _parentContext: Context): void {
    // No-op by design.
  }

  onEnd(span: ReadableSpan): void {
    const ctx = span.spanContext();
    const startedAtMs = Math.floor(span.startTime[0] * 1000 + span.startTime[1] / 1_000_000);
    const endedAtMs = Math.floor(span.endTime[0] * 1000 + span.endTime[1] / 1_000_000);
    const durationMs = Math.max(0, endedAtMs - startedAtMs);

    // Status: HTTP-shaped spans carry `http.status_code`; non-HTTP
    // spans (DB, internal) report 0 — the buffer's `status >= 500`
    // error count is a server-side filter so 0 doesn't trip false
    // positives.
    const attrs = span.attributes ?? {};
    const httpStatus =
      typeof attrs["http.status_code"] === "number"
        ? (attrs["http.status_code"] as number)
        : typeof attrs["http.response.status_code"] === "number"
          ? (attrs["http.response.status_code"] as number)
          : 0;

    const path =
      typeof attrs["http.target"] === "string"
        ? (attrs["http.target"] as string)
        : typeof attrs["url.path"] === "string"
          ? (attrs["url.path"] as string)
          : span.name;

    const method =
      typeof attrs["http.method"] === "string"
        ? (attrs["http.method"] as string)
        : typeof attrs["http.request.method"] === "string"
          ? (attrs["http.request.method"] as string)
          : (span.name.split(" ")[0] ?? "SPAN");

    this.buffer.record({
      requestId: ctx.traceId,
      method,
      path,
      startedAtMs,
      durationMs,
      status: httpStatus,
      ...(span.status?.code === 2
        ? { error: { name: "SpanError", message: span.status.message ?? "" } }
        : {}),
    });
  }

  async forceFlush(): Promise<void> {
    // The buffer is in-memory; nothing to flush.
  }

  async shutdown(): Promise<void> {
    // Buffer state survives so subsequent reads still work.
  }
}
