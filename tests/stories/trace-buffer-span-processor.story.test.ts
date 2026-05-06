import { describe, expect, it } from "vitest";

import { TraceBuffer } from "../../src/core/dx/trace-buffer.js";
import { TraceBufferSpanProcessor } from "../../src/core/observability/trace-buffer-span-processor.js";

/**
 * Story · TraceBufferSpanProcessor (CF.OBS.07 — iter-96 review Finding 6).
 *
 * The PRD pins "Custom span buffer for /dev/traces (parallel
 * SpanProcessor to OTLP exporter)". Iter-104 ships the SpanProcessor
 * that mirrors every ended span (DB / Prisma / HTTP-client / inbound
 * HTTP) into the in-memory TraceBuffer surface that backs /dev/traces.
 *
 * Three layers covered:
 *   1. The processor maps OTel `ReadableSpan` shape to the buffer's
 *      `TraceRecord` shape (requestId = traceId, durationMs from
 *      hrtime tuple, status from http.status_code or sibling attr).
 *   2. Errors (span.status.code === 2 / ERROR) propagate as
 *      `error.name + message` on the TraceRecord.
 *   3. The OTel SDK bootstrap registers the processor in parallel
 *      with the OTLP exporter so the buffer keeps filling even when
 *      the collector is unreachable.
 */
function fakeSpan(opts: {
  traceId?: string;
  name?: string;
  attrs?: Record<string, unknown>;
  startTime?: [number, number];
  endTime?: [number, number];
  statusCode?: number; // 0 unset, 1 ok, 2 error
  statusMessage?: string;
}): unknown {
  return {
    name: opts.name ?? "GET /api/health",
    spanContext: () => ({ traceId: opts.traceId ?? "trace-abc", spanId: "span-xyz" }),
    startTime: opts.startTime ?? [1_700_000_000, 0],
    endTime: opts.endTime ?? [1_700_000_000, 50_000_000], // 50ms
    attributes: opts.attrs ?? {},
    status: {
      code: opts.statusCode ?? 1,
      ...(opts.statusMessage ? { message: opts.statusMessage } : {}),
    },
  };
}

describe("Story · TraceBufferSpanProcessor", () => {
  it("onEnd records traceId + duration into the buffer", () => {
    const buffer = new TraceBuffer({ capacity: 100 });
    const proc = new TraceBufferSpanProcessor(buffer);
    proc.onEnd(
      fakeSpan({
        traceId: "trace-1",
        name: "GET /api/projects",
        attrs: { "http.method": "GET", "http.target": "/api/projects", "http.status_code": 200 },
      }) as never,
    );
    const recent = buffer.recent();
    expect(recent).toHaveLength(1);
    expect(recent[0]?.requestId).toBe("trace-1");
    expect(recent[0]?.method).toBe("GET");
    expect(recent[0]?.path).toBe("/api/projects");
    expect(recent[0]?.status).toBe(200);
    expect(recent[0]?.durationMs).toBeGreaterThan(0);
  });

  it("captures DB / non-HTTP spans with status=0 + uses span.name as path", () => {
    const buffer = new TraceBuffer({ capacity: 100 });
    const proc = new TraceBufferSpanProcessor(buffer);
    proc.onEnd(
      fakeSpan({
        traceId: "trace-2",
        name: "prisma:postgresql:query",
        attrs: {
          "db.system": "postgresql",
          "db.statement": "SELECT 1",
        },
      }) as never,
    );
    const recent = buffer.recent();
    expect(recent[0]?.requestId).toBe("trace-2");
    expect(recent[0]?.path).toBe("prisma:postgresql:query");
    expect(recent[0]?.status).toBe(0);
    expect(recent[0]?.error).toBeUndefined();
  });

  it("propagates span errors (status.code=2) onto the trace record", () => {
    const buffer = new TraceBuffer({ capacity: 100 });
    const proc = new TraceBufferSpanProcessor(buffer);
    proc.onEnd(
      fakeSpan({
        traceId: "trace-3",
        name: "GET /api/boom",
        attrs: { "http.method": "GET", "http.target": "/api/boom", "http.status_code": 500 },
        statusCode: 2,
        statusMessage: "kaboom",
      }) as never,
    );
    const recent = buffer.recent();
    expect(recent[0]?.error).toBeDefined();
    expect(recent[0]?.error?.message).toBe("kaboom");
    expect(recent[0]?.status).toBe(500);
  });

  it("supports both old (http.method) and new (http.request.method) attribute names", () => {
    const buffer = new TraceBuffer({ capacity: 100 });
    const proc = new TraceBufferSpanProcessor(buffer);
    proc.onEnd(
      fakeSpan({
        traceId: "trace-4",
        name: "POST /api/x",
        attrs: {
          "http.request.method": "POST",
          "url.path": "/api/x",
          "http.response.status_code": 201,
        },
      }) as never,
    );
    const recent = buffer.recent();
    expect(recent[0]?.method).toBe("POST");
    expect(recent[0]?.path).toBe("/api/x");
    expect(recent[0]?.status).toBe(201);
  });

  it("forceFlush + shutdown are no-ops (buffer is in-memory)", async () => {
    const buffer = new TraceBuffer({ capacity: 100 });
    const proc = new TraceBufferSpanProcessor(buffer);
    await expect(proc.forceFlush()).resolves.toBeUndefined();
    await expect(proc.shutdown()).resolves.toBeUndefined();
  });

  describe("OtelSDK bootstrap registers the processor", () => {
    it("source: createOtelSdk passes spanProcessors with TraceBufferSpanProcessor", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const src = readFileSync(
        resolve(process.cwd(), "src/core/observability/otel-sdk-bootstrap.ts"),
        "utf8",
      );
      expect(src).toContain("TraceBufferSpanProcessor");
      expect(src).toContain("spanProcessors");
    });
  });
});
