import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";

import { getTraceBuffer } from "../dx/trace-buffer.js";
import {
  type RequestContext,
  generateRequestId,
  requestContextStorage,
} from "./request-context.js";
import {
  formatTraceparent,
  generateSpanId,
  generateTraceId,
  parseTraceparent,
} from "./traceparent.js";

/**
 * Express middleware that initializes a `RequestContext` for every
 * inbound HTTP request and runs the rest of the request lifecycle inside
 * `storage.run()`.
 *
 * Trace-id resolution:
 *   - `traceparent` header parses cleanly → reuse upstream trace
 *   - missing / malformed → mint a new trace
 * The outbound response always carries a normalized `traceparent` and an
 * `X-Request-Id` for client-side log correlation.
 *
 * MAJ-3 fix: the previous `async () => { next() }` wrapper ended the
 * ALS scope prematurely — Node.js AsyncLocalStorage only keeps the
 * context alive for continuations that are created *within* the
 * `storage.run()` callback. An `async` wrapper creates a new
 * micro-task continuation *before* `next()` is called, so any
 * async work the downstream handler enqueues may run outside the
 * original context. Using the synchronous form `storage.run(ctx, fn)`
 * keeps the context alive for all async continuations that originate
 * from the synchronous `next()` call.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const ctx = this.buildContext(req);

    res.setHeader("x-request-id", ctx.requestId);
    res.setHeader(
      "traceparent",
      formatTraceparent({ traceId: ctx.traceId, parentId: ctx.parentId, sampled: ctx.sampled }),
    );

    // Record one trace per HTTP request — surfaced via /dev/traces.
    // Capturing on `finish` (success) and `close` (early disconnect)
    // gives us the actual handler duration.
    const startedAtMs = Date.now();
    const startNs = process.hrtime.bigint();
    const buffer = getTraceBuffer();
    let recorded = false;
    const recordTrace = (): void => {
      if (recorded) return;
      recorded = true;
      const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
      buffer.record({
        requestId: ctx.requestId,
        method: (req.method ?? "GET").toUpperCase(),
        path: req.originalUrl ?? req.url ?? "/",
        startedAtMs,
        durationMs,
        status: res.statusCode,
      });
    };
    res.on("finish", recordTrace);
    res.on("close", recordTrace);

    // `requestContextStorage.run()` is synchronous — the ALS context is
    // active for all async continuations that originate from the `next()`
    // call inside. Errors thrown synchronously by `next()` are forwarded
    // to Express' error-handler via the `catch` block so the ALS scope
    // is still intact when the error filter runs.
    requestContextStorage.run(ctx, () => {
      try {
        next();
      } catch (err) {
        next(err as Error);
      }
    });
  }

  private buildContext(req: Request): RequestContext {
    const headerValue = headerToString(req.headers.traceparent);
    const parsed = headerValue ? parseTraceparent(headerValue) : null;

    // MIN-1: Only trust the sampled flag from internal callers.
    // External callers could inject sampled=1 to exhaust the OTLP
    // exporter budget (trace-injection via traceparent). An internal
    // hop is identified by the `x-internal-request: 1` header which
    // the load-balancer / sidecar sets — external traffic never carries
    // this header (or would have it stripped at the ingress).
    const isInternal = req.headers["x-internal-request"] === "1";

    if (parsed) {
      return {
        requestId: generateRequestId(),
        traceId: parsed.traceId,
        parentId: parsed.parentId,
        // Limit sampled=true to trusted internal callers only.
        sampled: isInternal ? parsed.sampled : false,
      };
    }

    return {
      requestId: generateRequestId(),
      traceId: generateTraceId(),
      parentId: generateSpanId(),
      sampled: false,
    };
  }
}

function headerToString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
